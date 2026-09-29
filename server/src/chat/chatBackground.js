import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import config from '../config.js';
import Tour from '../models/tourModel.js';
import { loadSharp } from '../photos/imageFiles.js';

// The Kotyogó's background: a landscape photo from the tour's own album,
// made pale (75% white baked into the file, so the browser just shows it)
// and changing every week by itself - worked out from the tour and the week
// number, so nothing needs to run on Monday. An admin can pick another one
// for the rest of the week ("Másik háttér"). One file per tour:
// THUMBNAILS_ROOT/_backgrounds/<tourId>.w<white %>.webp - named after its
// paleness too, so changing WHITE remakes it (same photo) by itself. A tour without landscape
// photos keeps the plain background.

const WIDTH = 1920;
const WHITE = 0.75; // how much white is mixed into the photo
const LANDSCAPE_RATIO = 1.3; // at least this much wider than tall

const whitePercent = Math.round(WHITE * 100);

export const backgroundPath = (tourId) =>
  path.join(config.thumbnailsRoot, '_backgrounds', `${tourId}.w${whitePercent}.webp`);

// Files of an earlier paleness (or from before it was in the name).
function removeOtherVersions(tourId) {
  const dir = path.join(config.thumbnailsRoot, '_backgrounds');
  const current = path.basename(backgroundPath(tourId));
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (name.startsWith(`${tourId}.`) && name.endsWith('.webp') && name !== current) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

// "2026-W40" - the ISO week (Monday to Sunday).
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday decides the year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// The album's photos that fit behind a chat: landscape, and never a
// restricted one (not everyone may see those).
export const landscapePhotos = (images = []) =>
  images.filter(
    (i) => !i.restricted && i.width && i.height && i.width >= i.height * LANDSCAPE_RATIO,
  );

const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex');

// This week's photo: the same for everyone all week, another one next week.
export function weeklyPick(tourId, week, photos) {
  const n = parseInt(hashOf(`${tourId}:${week}`).slice(0, 8), 16);
  return photos[n % photos.length].filename;
}

// The pale version of one photo, written in place of the tour's previous one.
async function makeBackground(tour, filename) {
  const sharp = await loadSharp();
  const src = path.join(config.photosRoot, tour.sourceFolder, filename);
  const dest = backgroundPath(tour._id);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    await sharp(src)
      .rotate() // upright by its EXIF orientation
      .flatten({ background: '#ffffff' }) // a see-through PNG on white
      .resize({ width: WIDTH, withoutEnlargement: true })
      .linear(1 - WHITE, 255 * WHITE) // 25% photo, 75% white
      .webp({ quality: 70 })
      .toFile(tmp);
    fs.renameSync(tmp, dest);
    removeOtherVersions(tour._id);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// The browser keeps the file for a year; this changes with it - the photo,
// the week, and the paleness.
const versionOf = ({ week, filename }) =>
  `${week}.${hashOf(`${filename}:${whitePercent}`).slice(0, 8)}`;

async function loadTour(tourId) {
  const tour = await Tour.findById(tourId).select('+images +sourceFolder +chatBackground');
  if (!tour) throw new AppError('Nincs ilyen tábor.', 404);
  return tour;
}

// One background made at a time per tour (a whole chat opening at once).
const inFlight = new Map();

async function setBackground(tour, filename, week) {
  const key = String(tour._id);
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      (async () => {
        await makeBackground(tour, filename);
        tour.chatBackground = { filename, week };
        await tour.save({ validateModifiedOnly: true });
      })().finally(() => inFlight.delete(key)),
    );
  }
  await inFlight.get(key);
}

// GET: which background to show now - { version }, or null for none. Made
// (or remade) here when the week has turned or its photo left the album.
export async function currentBackground(tourId) {
  const tour = await loadTour(tourId);
  const photos = landscapePhotos(tour.images);
  if (!tour.sourceFolder || !photos.length) return null;

  const week = isoWeek();
  const saved = tour.chatBackground;
  const stillThere = (f) => photos.some((p) => p.filename === f);
  if (
    saved?.week === week &&
    stillThere(saved.filename) &&
    fs.existsSync(backgroundPath(tour._id))
  ) {
    return { version: versionOf(saved) };
  }
  const filename =
    saved?.week === week && stillThere(saved.filename)
      ? saved.filename
      : weeklyPick(String(tour._id), week, photos);
  try {
    await setBackground(tour, filename, week);
  } catch {
    return null; // a photo sharp can't read: the plain background
  }
  return { version: versionOf({ week, filename }) };
}

// "Másik háttér" (admin): another landscape photo, for the rest of the week.
export async function nextBackground(tourId) {
  const tour = await loadTour(tourId);
  const current = tour.chatBackground?.filename;
  const others = landscapePhotos(tour.images).filter((p) => p.filename !== current);
  if (!tour.sourceFolder || !others.length) {
    throw new AppError('Ehhez a táborhoz nincs másik fekvő fotó.', 409);
  }
  const { filename } = others[crypto.randomInt(others.length)];
  const week = isoWeek();
  await setBackground(tour, filename, week);
  return { version: versionOf({ week, filename }) };
}
