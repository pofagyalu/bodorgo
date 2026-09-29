import { Readable } from 'stream';
import AppError from '../utils/appError.js';
import logger from '../logger.js';
import { fetchTrackAudio, fetchTrackImage, playlistTracks } from '../music/jellyfin.js';

// The background music player (see music/jellyfin.js) - for anyone logged
// in. The browser gets the track list and the audio from here; Jellyfin
// and its key stay on the server.

// GET /music/playlist - the playlist's tracks, in order.
export const getPlaylist = async (req, res) => {
  // imageFrom (which Jellyfin item the picture is) stays on the server.
  const tracks = (await playlistTracks()).map(({ imageFrom, ...track }) => track);
  res.status(200).json({ status: 'success', results: tracks.length, data: { tracks } });
};

// GET /music/image/:itemId - a song's thumbnail (the artist's photo, or the
// album cover - see music/jellyfin.js). Only a song of the playlist.
export const getTrackImage = async (req, res) => {
  const track = (await playlistTracks()).find((t) => t.id === req.params.itemId);
  if (!track?.imageFrom) throw new AppError('Nincs kép ehhez a számhoz.', 404);
  const upstream = await fetchTrackImage(track.imageFrom);
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(await upstream.arrayBuffer()));
};

// What's passed on from Jellyfin's answer - enough for the browser to play
// and seek (Range → 206 + Content-Range).
const PASSED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

// GET /music/stream/:itemId - one track's audio, piped through. Only a
// track of the playlist - not any Jellyfin item by its id.
export const streamTrack = async (req, res) => {
  const { itemId } = req.params;
  const tracks = await playlistTracks();
  if (!tracks.some((t) => t.id === itemId)) throw new AppError('Nincs ilyen zeneszám.', 404);

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
