import fs from 'fs';
import path from 'path';
import exifr from 'exifr';

// What every photo sync needs: which files are photos, the thumbnail each
// gets, and the facts the gallery needs about it.

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
const THUMB_WIDTH = 400;

export const isImageFile = (name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());

// A photo's thumbnail: the same relative path under the thumbnails folder,
// as .webp ("mobil/IMG_1.jpg" -> "mobil/IMG_1.webp").
export function thumbRelPath(relPath) {
  const dir = path.dirname(relPath);
  const name = `${path.parse(relPath).name}.webp`;
  return dir === '.' ? name : path.join(dir, name);
}

// sharp has a native (compiled) part, so it isn't bundled into the server:
// deploy ships a Linux build of it next to server.js (see sync.js), and
// only photo discovery loads it - on demand. If it's missing, discovery
// reports that; the rest of the server never needs it.
export async function loadSharp() {
  const mod = await import('sharp');
  return mod.default ?? mod;
}

// When the photo was taken, from its EXIF data (phones and cameras both
// write it); null if the file has none.
export async function readTakenAt(file) {
  try {
    const exif = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const date = exif?.DateTimeOriginal ?? exif?.CreateDate;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

// Makes the thumbnail and returns what the gallery needs: the upright
// width/height (.rotate() applies the EXIF orientation - a portrait photo
// would otherwise come out sideways), the file size and when it was taken.
export async function processPhoto(sharp, src, thumbDest) {
  fs.mkdirSync(path.dirname(thumbDest), { recursive: true });
  const { width, height } = await sharp(src).rotate().metadata();
  await sharp(src).rotate().resize({ width: THUMB_WIDTH }).webp({ quality: 75 }).toFile(thumbDest);
  const { size } = fs.statSync(src);
  return { width, height, size, takenAt: await readTakenAt(src) };
}

// Photos in time order - takenAt first (so a phone's and a camera's photos
// interleave the way the day went), the file path for those without one.
export function byTakenAt(a, b) {
  const ta = a.takenAt ? new Date(a.takenAt).getTime() : null;
  const tb = b.takenAt ? new Date(b.takenAt).getTime() : null;
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return a.filename.localeCompare(b.filename);
}
