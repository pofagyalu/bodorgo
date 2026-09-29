import config from '../config.js';
import AppError from '../utils/appError.js';

// The background music: one fixed Jellyfin playlist (JELLYFIN_PLAYLIST_ID),
// read with a server-side API key. The browser only ever talks to our own
// /music routes (musicController.js) - never to Jellyfin, never with the
// key. The playlist itself is managed in Jellyfin.

const CACHE_MS = 5 * 60 * 1000;
let cached = null; // { at, tracks }

export const musicConfigured = () =>
  !!(config.jellyfin.url && config.jellyfin.apiKey && config.jellyfin.playlistId);

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
export function toTrack(item, imageFrom = null) {
  return {
    id: item.Id,
    title: item.Name,
    artist: item.AlbumArtist || item.Artists?.[0] || 'Ismeretlen előadó',
    durationMs: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MS) : null,
    streamUrl: `/music/stream/${item.Id}`,
    imageUrl: imageFrom ? `/music/image/${item.Id}` : null,
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

// The playlist's tracks, in its order - cached a few minutes.
export async function playlistTracks({ fresh = false } = {}) {
  if (!musicConfigured()) throw new AppError('A zene nincs beállítva.', 503);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.tracks;

  let url;
  try {
    url = jellyfinUrl(`/Playlists/${config.jellyfin.playlistId}/Items`, {
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
  const tracks = await Promise.all(items.map(async (i) => toTrack(i, await pictureSource(i))));
  cached = { at: Date.now(), tracks };
  return tracks;
}

// For the tests: forget the cached playlist (and the listing user).
export function clearPlaylistCache() {
  cached = null;
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
