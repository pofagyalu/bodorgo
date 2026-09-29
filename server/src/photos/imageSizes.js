import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import config from '../config.js';
import logger from '../logger.js';
import { getClubSettings } from '../utils/clubSettings.js';
import { loadSharp } from './imageFiles.js';

// Kép gyorsítótár: smaller WebP versions of the tour albums' and Média →
// Fotók's photos, so opening one on a phone doesn't pull a 5-10 MB
// original. The viewer asks for a width (?w=800/1200/1920 - it picks by the
// screen's width and pixel density); the version is made the first time
// someone asks for it and kept in THUMBNAILS_ROOT/_sizes/ for everyone
// after. Only on demand - nothing is made in advance. The originals stay
// untouched (download, zip).
//
// The folder is kept under an admin-set quota (Beállítások): once over it,
// the versions not viewed for the longest go first, down to 90%. A file's
// modified time is its "last viewed" (refreshed when served, at most once
// a day) - a deleted version is simply made again when next asked for.

export const SIZES = [800, 1200, 1920];
const DEFAULT_QUOTA_MB = 5120;
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;
// A few at a time: a big PNG takes a lot of memory to decode, and the NAS
// is small. The viewer asks for the next/previous photos too.
const MAX_PARALLEL = 2;
const QUOTA_CHECK_DELAY_MS = 60 * 1000;

export const sizesRoot = () => path.join(config.thumbnailsRoot, '_sizes');

// ?w= - one of SIZES, or none (the original).
export function requestedWidth(query) {
  if (query.w === undefined) return null;
  const width = Number(query.w);
  if (!SIZES.includes(width)) {
    throw new AppError(`A méret csak ${SIZES.join(', ')} lehet.`, 400);
  }
  return width;
}

// A photo's versions sit together, named after the whole original name (so
// "a.jpg" and "a.png" don't collide): <key>/<dir>/<name.ext>.<width>.webp.
// key is "tours/<sourceFolder>" or "media/<category>".
export function sizedPath(key, filename, width) {
  return path.join(sizesRoot(), key, `${filename}.${width}.webp`);
}

// Deletes every version of these photos - when they're gone from their
// folder. Best effort, like the thumbnails: a leftover one is harmless.
export function removeSizedVersions(key, filenames) {
  for (const filename of filenames) {
    for (const width of SIZES) fs.rmSync(sizedPath(key, filename, width), { force: true });
  }
}

// A whole category/tour folder gone.
export function removeSizedFolder(key) {
  fs.rmSync(path.join(sizesRoot(), key), { recursive: true, force: true });
}

// --- Making a version ---

const inFlight = new Map(); // dest -> promise, so one version is made once
const waiting = [];
let running = 0;

async function withSlot(job) {
  if (running >= MAX_PARALLEL) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function makeVersion(src, dest, width) {
  const sharp = await loadSharp();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    // .rotate() applies the EXIF orientation: a phone saves a portrait photo
    // lying on its side with a "turn me" note, which the WebP would lose.
    await sharp(src)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(tmp);
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  scheduleQuotaCheck();
}

// The version's path - made first if it's missing or older than the
// original (a photo replaced under the same name).
export async function ensureSizedVersion(src, dest, width) {
  const srcStat = fs.statSync(src);
  const destStat = fs.statSync(dest, { throwIfNoEntry: false });
  if (destStat && destStat.mtimeMs >= srcStat.mtimeMs) {
    if (Date.now() - destStat.mtimeMs > TOUCH_AFTER_MS) {
      const now = new Date();
      try {
        fs.utimesSync(dest, now, now);
      } catch {
        // only the "last viewed" mark - not worth failing the photo over
      }
    }
    return dest;
  }
  if (!inFlight.has(dest)) {
    inFlight.set(
      dest,
      withSlot(() => makeVersion(src, dest, width)).finally(() => inFlight.delete(dest)),
    );
  }
  await inFlight.get(dest);
  return dest;
}

// A year: photos here practically never change.
export const LONG_CACHE = 'private, max-age=31536000';

// Sends the original (no ?w=) or the asked-for version of it.
export async function sendPhoto(res, src, { key, filename, width }) {
  if (!fs.existsSync(src)) throw new AppError('A fénykép nem található a lemezen.', 404);
  res.set('Cache-Control', LONG_CACHE);
  if (!width) return res.sendFile(src);
  let file;
  try {
    file = await ensureSizedVersion(src, sizedPath(key, filename, width), width);
  } catch (err) {
    // Something sharp can't read: the original still shows.
    logger.warn(`image size ${width} of ${key}/${filename} failed: ${err.message}`);
    return res.sendFile(src);
  }
  res.sendFile(file);
}

// --- The folder and its quota ---

function listFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, out);
    else if (e.isFile() && e.name.endsWith('.webp')) {
      const { size, mtimeMs } = fs.statSync(full);
      out.push({ file: full, size, mtimeMs });
    }
  }
  return out;
}

export function imageCacheUsage() {
  const files = listFiles(sizesRoot());
  return { bytes: files.reduce((sum, f) => sum + f.size, 0), count: files.length };
}

export async function imageCacheQuotaBytes() {
  const { imageCache } = await getClubSettings();
  return (imageCache?.quotaMB ?? DEFAULT_QUOTA_MB) * 1024 * 1024;
}

// Over the quota: the least recently viewed go, down to 90% of it.
// Returns how many were deleted.
export async function enforceImageCacheQuota() {
  const limit = await imageCacheQuotaBytes();
  const files = listFiles(sizesRoot());
  let bytes = files.reduce((sum, f) => sum + f.size, 0);
  if (bytes <= limit) return 0;
  const target = limit * 0.9;
  let removed = 0;
  for (const f of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (bytes <= target) break;
    fs.rmSync(f.file, { force: true });
    bytes -= f.size;
    removed++;
  }
  return removed;
}

// Gyorsítótár ürítése: everything goes; made again as viewed.
export function clearImageCache() {
  const { count } = imageCacheUsage();
  fs.rmSync(sizesRoot(), { recursive: true, force: true });
  return count;
}

// After a new version: a check a minute later - one for a whole burst of
// them (a gallery being browsed), not a folder walk per photo.
let quotaTimer = null;
function scheduleQuotaCheck() {
  if (quotaTimer) return;
  quotaTimer = setTimeout(() => {
    quotaTimer = null;
    enforceImageCacheQuota().catch((err) =>
      logger.error(`image cache quota check failed: ${err.message}`),
    );
  }, QUOTA_CHECK_DELAY_MS);
  quotaTimer.unref?.();
}
