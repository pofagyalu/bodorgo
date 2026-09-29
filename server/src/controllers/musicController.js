import { Readable } from 'stream';
import AppError from '../utils/appError.js';
import logger from '../logger.js';
import {
  fetchTrackAudio,
  fetchTrackImage,
  playlistByKey,
  playlistTracks,
} from '../music/jellyfin.js';

// The music (see music/jellyfin.js): the playlists' tracks, audio and
// pictures, by the playlist's name (/music/bodorgo-fm/..., /music/buli/...).
// Jellyfin and its key stay on the server.

// Every /music/:key route: the playlist must exist and be set up, and a
// members-only one (Buli) isn't for guests.
export const playlistAccess = (req, res, next) => {
  const playlist = playlistByKey(req.params.key);
  if (playlist.membersOnly && req.user.role === 'guest') {
    throw new AppError('Ez a lejátszási lista csak klubtagoknak szól.', 403);
  }
  next();
};

// imageFrom (which Jellyfin item the picture is) stays on the server.
const forClient = (tracks) => tracks.map(({ imageFrom: _imageFrom, ...track }) => track);

// GET /music/:key/playlist - the tracks, in order.
export const getPlaylist = async (req, res) => {
  const tracks = forClient(await playlistTracks(req.params.key));
  // The browser may keep it a while too (the lists rarely change).
  res.setHeader('Cache-Control', 'private, max-age=1800');
  res.status(200).json({ status: 'success', results: tracks.length, data: { tracks } });
};

// POST /music/:key/refresh (admin) - reloaded from Jellyfin now, after a
// change there (otherwise every 12 hours).
export const refreshPlaylist = async (req, res) => {
  const tracks = forClient(await playlistTracks(req.params.key, { fresh: true }));
  res.status(200).json({ status: 'success', results: tracks.length, data: { tracks } });
};

async function trackOf(req) {
  const track = (await playlistTracks(req.params.key)).find((t) => t.id === req.params.itemId);
  if (!track) throw new AppError('Nincs ilyen zeneszám.', 404);
  return track;
}

// GET /music/:key/image/:itemId - a song's thumbnail (the artist's photo,
// or the album cover). Only a song of that playlist.
export const getTrackImage = async (req, res) => {
  const track = await trackOf(req);
  if (!track.imageFrom) throw new AppError('Nincs kép ehhez a számhoz.', 404);
  const upstream = await fetchTrackImage(track.imageFrom);
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(await upstream.arrayBuffer()));
};

// What's passed on from Jellyfin's answer - enough for the browser to play
// and seek (Range → 206 + Content-Range).
const PASSED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

// GET /music/:key/stream/:itemId - one song's audio, piped through. Only a
// song of that playlist - not any Jellyfin item by its id.
export const streamTrack = async (req, res) => {
  const { itemId } = req.params;
  await trackOf(req);

  // The listener skipped or left: stop fetching from Jellyfin too.
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  let upstream;
  try {
    upstream = await fetchTrackAudio(itemId, req.headers.range, abort.signal);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  }

  res.status(upstream.status);
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (!upstream.body) return res.end();
  Readable.from(upstream.body)
    .on('error', (err) => {
      if (err?.name !== 'AbortError') logger.warn(`music stream ${itemId} broke: ${err.message}`);
      res.destroy();
    })
    .pipe(res);
};
