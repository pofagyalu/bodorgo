import mongoose from 'mongoose';
import View from '../models/viewModel.js';
import Tour from '../models/tourModel.js';
import { budapestYmd } from './huDate.js';
import { canSeeTourMedia } from './tourMediaAccess.js';
import { tourVideoList } from './tourVideos.js';
import { canViewRestrictedImages } from '../controllers/tourImageController.js';
import { visibleMediaPhoto } from '../controllers/mediaPhotoController.js';
import { visibleMediaVideo } from '../controllers/mediaVideoController.js';
import { PLAYLISTS, playlistTracks } from '../music/jellyfin.js';

// Megtekintések (models/viewModel.js): what the app's pages say was looked
// at, and the most viewed of the last 30 days for the homepage's
// "Népszerű". The page decides when something counts as seen (the photo
// viewer, the video player, the tour page, the music player); the server
// records it at most once a day per person and item - and only what that
// person may see at all. Photos and videos come from two places, a tour's
// album and Média → Fotók / Videók: the key says which.

export const VIEW_TYPES = ['photo', 'video', 'tour', 'track'];

// "tour:<tourId>:<filename>", "media:<category>:<filename or video id>" -
// a filename may hold ":" itself, only the first two split.
const MEDIA_KEY = /^(tour|media):([^:]+):(.+)$/;
const TRACK_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_KEY = 500;

const tourMediaParts = (key) => {
  const m = MEDIA_KEY.exec(key);
  return m ? { source: m[1], owner: m[2], item: m[3] } : null;
};

const mayUseMedia = (user) => user.role === 'admin' || user.role === 'member';

// A tour's photo, if this user may see it.
async function tourPhoto(user, tourId, filename) {
  if (!mongoose.isValidObjectId(tourId) || !(await canSeeTourMedia(user, tourId))) return null;
  const tour = await Tour.findById(tourId).select('+images title slug order').lean();
  const image = tour?.images?.find((i) => i.filename === filename);
  if (!image || (image.restricted && !(await canViewRestrictedImages(user, tourId)))) return null;
  return { tour, image };
}

// A tour's recap video, if this user may see it.
async function tourVideo(user, tourId, videoId) {
  if (!mongoose.isValidObjectId(tourId) || !(await canSeeTourMedia(user, tourId))) return null;
  const tour = await Tour.findById(tourId).select('title slug order').lean();
  const video = tour && tourVideoList(tour.order).find((v) => v.id === videoId);
  return video ? { tour, video } : null;
}

async function mediaPhoto(user, category, filename) {
  return mayUseMedia(user) ? visibleMediaPhoto(user, category, filename) : null;
}

async function mediaVideo(user, category, id) {
  return mayUseMedia(user) ? visibleMediaVideo(user, category, id) : null;
}

// A song of that playlist (every playlist is for everyone logged in).
async function track(playlist, itemId) {
  if (!Object.hasOwn(PLAYLISTS, playlist)) return null;
  try {
    return (await playlistTracks(playlist)).find((t) => t.id === itemId) ?? null;
  } catch {
    return null; // the music isn't set up, or Jellyfin can't be reached
  }
}

// Whether this user may see what a view is about (and it is there at all).
async function maySeeItem(user, { type, key, playlist }) {
  if (type === 'tour') {
    return mongoose.isValidObjectId(key) && !!(await Tour.exists({ _id: key }));
  }
  if (type === 'track') return !!(await track(playlist, key));
  const parts = tourMediaParts(key);
  if (!parts) return false;
  const { source, owner, item } = parts;
  if (type === 'photo') {
    return !!(source === 'tour'
      ? await tourPhoto(user, owner, item)
      : await mediaPhoto(user, owner, item));
  }
  return !!(source === 'tour'
    ? await tourVideo(user, owner, item)
    : await mediaVideo(user, owner, item));
}

// One view as the page sends it - null if it isn't one.
function cleanView(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { type, key, playlist } = raw;
  if (!VIEW_TYPES.includes(type) || typeof key !== 'string' || !key || key.length > MAX_KEY) {
    return null;
  }
  if (type === 'track') {
    return typeof playlist === 'string' && TRACK_ID.test(key) ? { type, key, playlist } : null;
  }
  return { type, key };
}

export const MAX_VIEWS_PER_REQUEST = 50;

// Records what this user has seen - each item once a day (one more today
// changes nothing). What isn't there, or isn't theirs to see, is left out.
// Returns how many of them were new today.
export async function recordViews(user, rawViews) {
  const unique = new Map();
  for (const raw of rawViews) {
    const view = cleanView(raw);
    if (view) unique.set(`${view.type}\n${view.key}`, view);
  }
  const allowed = [];
  for (const view of unique.values()) {
    if (await maySeeItem(user, view)) allowed.push(view);
  }
  if (!allowed.length) return 0;
  const day = budapestYmd();
  const result = await View.bulkWrite(
    allowed.map(({ type, key, playlist }) => ({
      updateOne: {
        filter: { type, key, user: user._id, day },
        update: { $setOnInsert: { at: new Date(), ...(playlist ? { playlist } : {}) } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return result.upsertedCount;
}

// --- The most viewed (the homepage's "Népszerű") ---

export const POPULAR_DAYS = 30;
// How many of each type are kept ranked: the homepage shows each person the
// first one they may see.
const RANKED = 20;
// Worked out again at most this often - the homepage asks on every visit.
const CACHE_MS = 10 * 60 * 1000;
let cache = new Map(); // type -> { at, ranked }

export function clearPopularCache() {
  cache = new Map();
}

// A type's most viewed in the last 30 days (today included): its views
// (person-days), then its different viewers, then the latest.
async function ranked(type) {
  const hit = cache.get(type);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ranked;
  const since = budapestYmd(new Date(Date.now() - (POPULAR_DAYS - 1) * 24 * 3600 * 1000));
  const list = await View.aggregate([
    { $match: { type, day: { $gte: since } } },
    {
      $group: {
        _id: '$key',
        views: { $sum: 1 },
        viewers: { $addToSet: '$user' },
        last: { $max: '$at' },
        playlist: { $last: '$playlist' },
      },
    },
    { $project: { views: 1, viewers: { $size: '$viewers' }, last: 1, playlist: 1 } },
    { $sort: { views: -1, viewers: -1, last: -1 } },
    { $limit: RANKED },
  ]);
  // Nothing yet isn't kept: the first view shows at once.
  if (list.length) cache.set(type, { at: Date.now(), ranked: list });
  return list;
}

const enc = encodeURIComponent;

// The cards: what the homepage shows and opens. Addresses are relative -
// on this server.
async function photoCard(user, key) {
  const parts = tourMediaParts(key);
  if (!parts) return null;
  const { source, owner, item } = parts;
  if (source === 'tour') {
    const found = await tourPhoto(user, owner, item);
    if (!found) return null;
    const { tour, image } = found;
    const base = `/tours/${tour._id}/images/${enc(image.filename)}`;
    return {
      source,
      key,
      title: `${tour.order}. ${tour.title}`,
      link: `/taborok/${tour.slug}`,
      filename: image.filename,
      width: image.width,
      height: image.height,
      fullUrl: base,
      thumbUrl: `${base}/thumb`,
      downloadUrl: `${base}/download`,
    };
  }
  const photo = await mediaPhoto(user, owner, item);
  if (!photo) return null;
  const base = `/media/photos/${enc(photo.category)}/${enc(photo.filename)}`;
  return {
    source,
    key,
    title: photo.title || photo.folderTitle,
    link: `/media/fotok/${enc(photo.category)}${photo.album ? `/${enc(photo.album)}` : ''}`,
    filename: photo.filename,
    width: photo.width,
    height: photo.height,
    fullUrl: base,
    thumbUrl: `${base}/thumb`,
    downloadUrl: `${base}/download`,
  };
}

// Plays the small copy when there is one (like the pages' player).
const playing = (base, { small, height, smallHeight, hasSubtitles }) => ({
  src: `${base}/video?quality=original`,
  smallSrc: small === 'ready' ? `${base}/video?quality=small` : null,
  subtitlesSrc: hasSubtitles ? `${base}/subtitles.vtt` : null,
  height: height ?? null,
  smallHeight: smallHeight ?? null,
});

async function videoCard(user, key) {
  const parts = tourMediaParts(key);
  if (!parts) return null;
  const { source, owner, item } = parts;
  if (source === 'tour') {
    const found = await tourVideo(user, owner, item);
    if (!found) return null;
    const { tour, video } = found;
    const base = `/tours/${tour._id}/videos/${video.id}`;
    return {
      source,
      key,
      title: video.label || 'Tábori videó',
      subtitle: `${tour.order}. ${tour.title}`,
      link: `/taborok/${tour.slug}`,
      coverUrl: video.hasCover
        ? `${base}/cover${video.coverVersion ? `?v=${video.coverVersion}` : ''}`
        : null,
      ...playing(base, video),
    };
  }
  const video = await mediaVideo(user, owner, item);
  if (!video) return null;
  const base = `/media/videos/${enc(owner)}/${item}`;
  return {
    source,
    key,
    title: video.title,
    subtitle: video.categoryTitle + (video.year ? ` · ${video.year}` : ''),
    link: `/media/videok/${enc(owner)}`,
    coverUrl: video.hasCover
      ? `${base}/cover${video.coverVersion ? `?v=${video.coverVersion}` : ''}`
      : null,
    ...playing(base, video),
  };
}

async function tourCard(user, key) {
  if (!mongoose.isValidObjectId(key)) return null;
  const tour = await Tour.findById(key).select('title slug order coverUpdatedAt').lean();
  if (!tour) return null;
  return {
    key,
    id: String(tour._id),
    title: tour.title,
    order: tour.order,
    link: `/taborok/${tour.slug}`,
    coverUrl: tour.coverUpdatedAt
      ? `/tours/${tour._id}/cover?v=${enc(new Date(tour.coverUpdatedAt).toISOString())}`
      : null,
  };
}

async function trackCard(user, key, playlist) {
  // Where it was played last - or any playlist it is still on.
  for (const list of [playlist, ...Object.keys(PLAYLISTS)].filter(Boolean)) {
    const found = await track(list, key);
    if (found) {
      return {
        key,
        playlist: list,
        id: found.id,
        title: found.title,
        artist: found.artist,
        imageUrl: found.imageUrl,
      };
    }
  }
  return null;
}

const CARDS = { photo: photoCard, video: videoCard, tour: tourCard, track: trackCard };

// For this user, each type's most viewed of the last 30 days that they may
// see - with how many views and viewers it had. null where there is none.
export async function popularFor(user) {
  const result = {};
  for (const type of VIEW_TYPES) {
    result[type] = null;
    for (const entry of await ranked(type)) {
      const card = await CARDS[type](user, entry._id, entry.playlist);
      if (card) {
        result[type] = { ...card, views: entry.views, viewers: entry.viewers };
        break;
      }
    }
  }
  return { days: POPULAR_DAYS, ...result };
}
