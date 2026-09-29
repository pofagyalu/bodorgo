import config from '../config.js';
import AppError from '../utils/appError.js';
import logger from '../logger.js';

// The music: a few fixed Jellyfin playlists, read with a server-side API
// key. The browser only ever talks to our own /music routes
// (musicController.js) - never to Jellyfin, never with the key. The
// playlists themselves are managed in Jellyfin.
//
// Each by a short name used in the addresses:
// - 'bodorgo-fm': the club radio - everyone logged in (the header player);
// - 'buli': party music - members (and admins) only.
export const PLAYLISTS = {
  'bodorgo-fm': { id: () => config.jellyfin.playlistId, membersOnly: false },
  buli: { id: () => config.jellyfin.buliPlaylistId, membersOnly: true },
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

// The playlists change only now and then - refreshed (in the background)
// every 12 hours; an admin can refresh one at once (POST .../refresh), and a
// server restart reloads them all.
const CACHE_MS = 12 * 60 * 60 * 1000;
const cache = new Map(); // key -> { at, tracks }
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

// Jellyfin's item -> what the player needs. The stream and the picture go
// through us. imageFrom: the Jellyfin item whose picture is shown - see
// pictureSource (kept on the server, not sent).
export function toTrack(key, item, imageFrom = null) {
  return {
    id: item.Id,
    title: item.Name,
    artist: item.AlbumArtist || item.Artists?.[0] || 'Ismeretlen előadó',
    durationMs: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MS) : null,
    streamUrl: `/music/${key}/stream/${item.Id}`,
    imageUrl: imageFrom ? `/music/${key}/image/${item.Id}` : null,
    imageFrom,
  };
}

// Which artists have a photo in Jellyfin - asked once per artist.
const artistHasPhoto = new Map();
async function hasPhoto(itemId) {
  if (!artistHasPhoto.has(itemId)) {
    try {
      const res = await fetch(jellyfinUrl(`/Items/${itemId}/Images`), { headers: authHeaders() });
      const images = res.ok ? await res.json() : [];
      artistHasPhoto.set(
        itemId,
        images.some((i) => i.ImageType === 'Primary'),
      );
    } catch {
      return false;
    }
  }
  return artistHasPhoto.get(itemId);
}

// A song's thumbnail: the artist's photo if Jellyfin has one, else the
// album cover, else the song's own picture - none: null.
async function pictureSource(item) {
  const artistId = item.AlbumArtists?.[0]?.Id || item.ArtistItems?.[0]?.Id;
  if (artistId && (await hasPhoto(artistId))) return artistId;
  if (item.AlbumId && item.AlbumPrimaryImageTag) return item.AlbumId;
  if (item.ImageTags?.Primary) return item.Id;
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
  return Promise.all(items.map(async (i) => toTrack(key, i, await pictureSource(i))));
}

// One refresh per playlist at a time, whoever asks.
function refresh(key) {
  if (!refreshing.has(key)) {
    refreshing.set(
      key,
      fetchPlaylist(key)
        .then((tracks) => {
          cache.set(key, { at: Date.now(), tracks });
          return tracks;
        })
        .finally(() => refreshing.delete(key)),
    );
  }
  return refreshing.get(key);
}

// A playlist's tracks, in its order. Once loaded, always answered at once
// from memory; when it's older than CACHE_MS it's refreshed in the
// background (nobody waits for that). Only the very first load waits - and
// warmUpMusic does that at server start. `fresh`: wait for Jellyfin now.
export async function playlistTracks(key, { fresh = false } = {}) {
  playlistByKey(key);
  const cached = cache.get(key);
  if (fresh || !cached) return refresh(key);
  if (Date.now() - cached.at > CACHE_MS) {
    refresh(key).catch((err) => logger.warn(`music ${key} refresh failed: ${err.message}`));
  }
  return cached.tracks;
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
  artistHasPhoto.clear();
}

// A song's thumbnail, square, resized by Jellyfin.
export async function fetchTrackImage(imageFrom, size = 320) {
  const url = jellyfinUrl(`/Items/${encodeURIComponent(imageFrom)}/Images/Primary`, {
    fillWidth: String(size),
    fillHeight: String(size),
    quality: '85',
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
