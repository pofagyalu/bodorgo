import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import config from '../config.js';
import AppError from '../utils/appError.js';
import logger from '../logger.js';

// The music: a few fixed Jellyfin playlists, read with a server-side API
// key. The browser only ever talks to our own /music routes
// (musicController.js) - never to Jellyfin, never with the key. The
// playlists themselves are managed in Jellyfin.
//
// Each by a short name used in the addresses:
// Every one of them is for everyone logged in - guests too.
// - 'bodorgo-fm': the club radio (the header player);
// - 'buli': party music;
// - 'hatter': quiet music behind a conversation. Most of its songs are tagged in Jellyfin with a collection's name
//   for an artist and "Artist - Title (Official Video)" for a title:
//   `collections` names those, and the artist is read out of the title
//   (titleAndArtist).
export const PLAYLISTS = {
  'bodorgo-fm': { id: () => config.jellyfin.playlistId },
  // Its songs' own pictures are the ones the owner picks (pictureSource).
  buli: { id: () => config.jellyfin.buliPlaylistId, ownPictureFirst: true },
  hatter: {
    id: () => config.jellyfin.hatterPlaylistId,
    // Its songs' own pictures are the ones the owner picks (pictureSource).
    ownPictureFirst: true,
    collections: ['Házigazda kedvencei'],
  },
};

// A playlist by its name, if it's set up - a 404 otherwise.
export function playlistByKey(key) {
  const playlist = Object.hasOwn(PLAYLISTS, key) ? PLAYLISTS[key] : null;
  if (!playlist) throw new AppError('Nincs ilyen lejátszási lista.', 404);
  if (!config.jellyfin.url || !config.jellyfin.apiKey || !playlist.id()) {
    throw new AppError('A zene nincs beállítva.', 503);
  }
  return playlist;
}

// The playlists change only now and then, and never on their own: loaded
// at server start (a restart reloads them all), and after that only when an
// admin reloads one (POST .../refresh) - nothing by the clock.
const cache = new Map(); // key -> the tracks
const refreshing = new Map(); // key -> the refresh in progress

// The key as a header, not ?api_key= - it stays out of every log.
const authHeaders = () => ({
  Authorization: `MediaBrowser Token="${config.jellyfin.apiKey}"`,
});

function jellyfinUrl(path, params = {}) {
  const url = new URL(`${config.jellyfin.url}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url;
}

const TICKS_PER_MS = 10000;

const UNKNOWN_ARTIST = 'Ismeretlen előadó';
// What a video's name carries after the song's: "(Official Music Video)",
// "[Official Audio]", "// Official Music Video", "4K Video".
const VIDEO_NOTE =
  /\s*(?:[([][^()[\]]*\b(?:official|video|videoklip|audio|lyrics?)\b[^()[\]]*[)\]]|\/\/.*|\b4K Video|\s[-–—]\s*official\b[^-–—]*)\s*$/i;
const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// A song's title and artist. Normally Jellyfin's own. In a playlist with
// `collections` (album artists that are a collection's name, not a
// performer) the name is tidied ("(Official Video)" and the like, a leading
// "03.") and, if it's "Artist - Title" (or "Artist | Title",
// 'Artist "Title"'), split - the other way round when the tagged artist is
// the second half ("Golden Brown - The Stranglers"). No artist in the name:
// the album artist if that's a performer, else the track's tagged artist.
export function titleAndArtist(item, collections) {
  const tagged = item.AlbumArtist || item.Artists?.[0] || UNKNOWN_ARTIST;
  if (!collections?.length) return { title: item.Name, artist: tagged };

  let name = String(item.Name ?? '');
  for (let before = null; before !== name;) {
    before = name;
    name = name
      .replace(VIDEO_NOTE, '')
      .replace(/\s+[-–—]\s*$/, '')
      .trim();
  }
  name = name.replace(/^\d{2}\.\s*/, '');
  const unquote = (s) => s.trim().replace(/^["“„](.*)["”]$/, '$1');

  const dashed = name.match(/^(.+?)\s+[-–—]\s+(.+)$/) ?? name.match(/^(.+?)\s+\|\s+(.+)$/);
  if (dashed) {
    const [, first, second] = dashed;
    return same(second, item.Artists?.[0])
      ? { title: unquote(first), artist: second.trim() }
      : { title: unquote(second), artist: first.trim() };
  }
  const quoted = name.match(/^(.+?)\s+"([^"]+)"(?:\s+•.*)?$/);
  if (quoted) return { title: quoted[2], artist: quoted[1].trim() };

  const performer = collections.some((c) => same(c, item.AlbumArtist)) ? null : item.AlbumArtist;
  return { title: name || item.Name, artist: performer || item.Artists?.[0] || UNKNOWN_ARTIST };
}

// Jellyfin's item -> what the player needs. The stream and the picture go
// through us. picture: the Jellyfin item whose picture is shown and that
// picture's tag (it changes when the picture does) - see pictureSource;
// both kept on the server (imageFrom, imageTag), not sent.
export function toTrack(key, item, picture = null) {
  const { title, artist } = titleAndArtist(item, PLAYLISTS[key]?.collections);
  return {
    id: item.Id,
    title,
    artist,
    durationMs: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MS) : null,
    streamUrl: `/music/${key}/stream/${item.Id}`,
    // The picture's tag in the address: a changed picture is a new address,
    // so no browser (or the app's offline copy) keeps showing the old one -
    // a picture is cached for a day (2026-10-22: changed covers didn't show).
    imageUrl: picture
      ? `/music/${key}/image/${item.Id}?v=${encodeURIComponent(picture.tag)}`
      : null,
    imageFrom: picture?.from ?? null,
    imageTag: picture?.tag ?? null,
  };
}

// Which artists have a photo in Jellyfin (its tag; null: none) - asked once
// per artist (whoever else asks meanwhile waits for the same answer), and
// again when an admin reloads a list. No answer from Jellyfin isn't "no
// photo": that's asked again the next time.
const NO_TAG = 'x';
const artistPhotos = new Map(); // artist's id -> the answer, or the asking in progress
function artistPhoto(itemId) {
  if (!artistPhotos.has(itemId)) {
    artistPhotos.set(
      itemId,
      (async () => {
        const res = await fetch(jellyfinUrl(`/Items/${itemId}/Images`), { headers: authHeaders() });
        if (!res.ok) throw new Error(`images: ${res.status}`);
        const photo = (await res.json()).find((i) => i.ImageType === 'Primary');
        return photo ? photo.ImageTag || NO_TAG : null;
      })().catch(() => {
        artistPhotos.delete(itemId);
        return null;
      }),
    );
  }
  return artistPhotos.get(itemId);
}

// A song's thumbnail: the artist's photo if Jellyfin has one, else the
// album cover, else the song's own picture - none: null. The artist: the
// album's, unless that is a collection's name (the playlist's
// `collections`) - then the track's own. A playlist with ownPictureFirst
// (Buli, Duruzsoló): the song's own picture before all of those - its songs sit
// in a collection's folder, whose one cover (or the artists' photos) hid
// the covers picked for each song (2026-10-22).
async function pictureSource(item, { collections = [], ownPictureFirst = false } = {}) {
  if (ownPictureFirst && item.ImageTags?.Primary) {
    return { from: item.Id, tag: item.ImageTags.Primary };
  }
  const albumArtist = item.AlbumArtists?.[0];
  const performer = collections.some((c) => same(c, albumArtist?.Name)) ? null : albumArtist;
  const artistId = performer?.Id || item.ArtistItems?.[0]?.Id;
  const photo = artistId ? await artistPhoto(artistId) : null;
  if (photo) return { from: artistId, tag: photo };
  if (item.AlbumId && item.AlbumPrimaryImageTag) {
    return { from: item.AlbumId, tag: item.AlbumPrimaryImageTag };
  }
  if (item.ImageTags?.Primary) return { from: item.Id, tag: item.ImageTags.Primary };
  return null;
}

// Jellyfin lists a playlist's items only as seen by some user. Ours is
// shared - every user sees the same tracks - so any user will do:
// JELLYFIN_USER_ID if set, otherwise the first one Jellyfin lists
// (asked once, then remembered).
let firstUserId = null;
async function listingUserId() {
  if (config.jellyfin.userId) return config.jellyfin.userId;
  if (firstUserId) return firstUserId;
  const res = await fetch(jellyfinUrl('/Users'), { headers: authHeaders() });
  if (!res.ok) throw new Error(`users: ${res.status}`);
  firstUserId = (await res.json())[0]?.Id ?? null;
  if (!firstUserId) throw new Error('no users');
  return firstUserId;
}

// Asks Jellyfin for a playlist's tracks (slow the first time: Jellyfin
// wakes up, and each artist is checked for a photo).
async function fetchPlaylist(key) {
  let url;
  try {
    url = jellyfinUrl(`/Playlists/${PLAYLISTS[key].id()}/Items`, {
      userId: await listingUserId(),
      fields:
        'RunTimeTicks,AlbumArtist,Artists,ImageTags,AlbumPrimaryImageTag,ArtistItems,AlbumArtists',
    });
  } catch {
    throw new AppError('A zenelejátszó most nem érhető el.', 502);
  }
  let res;
  try {
    res = await fetch(url, { headers: authHeaders() });
  } catch {
    throw new AppError('A zenelejátszó most nem érhető el.', 502);
  }
  if (!res.ok) throw new AppError('A zenelejátszó most nem érhető el.', 502);
  const body = await res.json();
  const items = (body.Items ?? []).filter((i) => i.Id);
  // One after the other: asked for every artist at once, Jellyfin drops some.
  const tracks = [];
  for (const i of items) {
    tracks.push(toTrack(key, i, await pictureSource(i, PLAYLISTS[key])));
  }
  return tracks;
}

// One refresh per playlist at a time, whoever asks.
function refresh(key) {
  if (!refreshing.has(key)) {
    refreshing.set(
      key,
      fetchPlaylist(key)
        .then((tracks) => {
          cache.set(key, tracks);
          // Nobody waits for the pictures.
          void keepImages(key, tracks);
          return tracks;
        })
        .finally(() => refreshing.delete(key)),
    );
  }
  return refreshing.get(key);
}

// A playlist's tracks, in its order. Once loaded, always answered from
// memory, however old. Only the very first load waits - and warmUpMusic
// does that at server start (if Jellyfin wasn't there then: when someone
// first asks). `fresh`: an admin's reload - wait for Jellyfin now.
export async function playlistTracks(key, { fresh = false } = {}) {
  playlistByKey(key);
  const cached = cache.get(key);
  // An admin's reload: the artists' photos are looked at again too.
  if (fresh) artistPhotos.clear();
  if (fresh || !cached) return refresh(key);
  return cached;
}

// At server start: every set-up playlist loaded before anyone asks.
export function warmUpMusic() {
  for (const key of Object.keys(PLAYLISTS)) {
    try {
      playlistByKey(key);
    } catch {
      continue; // not set up
    }
    refresh(key).catch((err) => logger.warn(`music ${key} warm-up failed: ${err.message}`));
  }
}

// For the tests: forget the cached playlists (and the listing user).
export function clearPlaylistCache() {
  cache.clear();
  refreshing.clear();
  firstUserId = null;
  artistPhotos.clear();
  downloading.clear();
}

// The songs' pictures are kept on the server's disk: Jellyfin is asked for
// one only the first time - a new song's, or one whose picture changed
// there (the tag is in the file's name) - as WebP, the smallest. Beside the photo thumbnails
// (THUMBNAILS_ROOT/_music), where the live server's file watch doesn't
// look; without that folder, the system's temporary one.
const imageDir = () =>
  config.jellyfin.imageCacheDir ||
  (config.thumbnailsRoot
    ? path.join(config.thumbnailsRoot, '_music')
    : path.join(os.tmpdir(), 'bodorgo-music-images'));

const SAFE_NAME = /^[\w-]+$/;
function imageFile(track) {
  const tag = track.imageTag || NO_TAG;
  if (!SAFE_NAME.test(track.imageFrom ?? '') || !SAFE_NAME.test(tag)) return null;
  return path.join(imageDir(), `${track.imageFrom}.${tag}.webp`);
}

const downloading = new Map(); // file -> the download in progress

// A track's picture: from the disk if it's there, else from Jellyfin - and
// kept for the next time.
export async function trackImage(track) {
  const file = imageFile(track);
  if (!file) return Buffer.from(await (await fetchTrackImage(track.imageFrom)).arrayBuffer());
  try {
    return await fs.readFile(file);
  } catch {
    // not kept yet
  }
  if (!downloading.has(file)) {
    downloading.set(
      file,
      (async () => {
        const data = Buffer.from(await (await fetchTrackImage(track.imageFrom)).arrayBuffer());
        try {
          await fs.mkdir(path.dirname(file), { recursive: true });
          const part = `${file}.${process.pid}.part`;
          await fs.writeFile(part, data);
          await fs.rename(part, file);
        } catch (err) {
          logger.warn(`music picture not kept (${file}): ${err.message}`);
        }
        return data;
      })().finally(() => downloading.delete(file)),
    );
  }
  return downloading.get(file);
}

// After a playlist is (re)loaded: the pictures not on the disk yet are
// fetched, one by one (easy on the NAS) - so nobody's browser waits for
// Jellyfin. Usually nothing to do: only a new song's picture is missing.
// The ones Jellyfin didn't give (it does that when asked for many at once)
// are tried once more a little later; still missing: asked again when
// someone needs it, or at the next load.
const RETRY_MS = 5000;
async function keepImages(key, tracks) {
  const seen = new Set();
  let missing = [];
  for (const track of tracks) {
    const file = track.imageFrom ? imageFile(track) : null;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    try {
      await fs.access(file);
    } catch {
      missing.push(track);
    }
  }
  let fetched = 0;
  for (const lastTry of [false, true]) {
    const failed = [];
    for (const track of missing) {
      try {
        await trackImage(track);
        fetched += 1;
      } catch {
        failed.push(track);
      }
    }
    missing = failed;
    if (lastTry || !missing.length) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS).unref());
  }
  if (fetched) logger.info(`music ${key}: ${fetched} new picture(s) kept on the server`);
  if (missing.length) logger.warn(`music ${key}: ${missing.length} picture(s) not fetched`);
}

// What kind of picture it is, from its first bytes.
export function imageType(data) {
  const start = data.subarray(0, 12).toString('latin1');
  if (start.startsWith('\x89PNG')) return 'image/png';
  if (start.startsWith('RIFF') && start.slice(8) === 'WEBP') return 'image/webp';
  if (start.startsWith('GIF8')) return 'image/gif';
  return 'image/jpeg';
}

// A song's thumbnail, square, resized and made a WebP by Jellyfin.
export async function fetchTrackImage(imageFrom, size = 320) {
  const url = jellyfinUrl(`/Items/${encodeURIComponent(imageFrom)}/Images/Primary`, {
    fillWidth: String(size),
    fillHeight: String(size),
    quality: '85',
    format: 'Webp',
  });
  let res;
  try {
    res = await fetch(url, { headers: authHeaders() });
  } catch {
    throw new AppError('A kép most nem érhető el.', 502);
  }
  if (!res.ok) throw new AppError('Nincs kép ehhez a számhoz.', 404);
  return res;
}

// One track's audio, as Jellyfin serves the original file (no transcoding -
// easy on the NAS, and byte ranges work, which Safari needs to play at
// all). `range`: the browser's Range header, passed on as it is.
export async function fetchTrackAudio(itemId, range, signal) {
  const url = jellyfinUrl(`/Audio/${encodeURIComponent(itemId)}/stream`, { static: 'true' });
  const headers = { ...authHeaders(), ...(range ? { Range: range } : {}) };
  let res;
  try {
    res = await fetch(url, { headers, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new AppError('A zenelejátszó most nem érhető el.', 502);
  }
  if (!res.ok && res.status !== 206) {
    throw new AppError('Ez a zeneszám most nem játszható le.', 502);
  }
  return res;
}
