import fs from 'fs';
import path from 'path';
import { MARKET_PHOTOS_DIR } from '../utils/dataDirs.js';
import { loadSharp } from '../photos/imageFiles.js';
import { openUploadedImage, withUploadSlot } from '../utils/uploadedImages.js';

// The Ócskapiac photos - like the chat's (chat/chatImages.js): the phone
// shrinks them first, here each becomes a WebP of at most 1600 px (EXIF -
// the GPS location included - dropped) and a small .webp thumbnail for the
// cards. Named by the photo's own id.

const MAX_SIDE = 1600;
const THUMB_SIDE = 480;

export const marketPhotoPath = (photoId) => path.join(MARKET_PHOTOS_DIR, `${photoId}.webp`);
export const marketThumbPath = (photoId) => path.join(MARKET_PHOTOS_DIR, `${photoId}.thumb.webp`);

// Throws if the bytes aren't a real image. Returns what the item records.
// Only a real picture, in its turn (utils/uploadedImages.js).
export function saveMarketPhoto(photoId, buffer) {
  return withUploadSlot(async () => {
    const sharp = await loadSharp();
    const uploaded = await openUploadedImage(buffer);
    fs.mkdirSync(MARKET_PHOTOS_DIR, { recursive: true });
    const full = await uploaded
      .rotate() // upright by its EXIF orientation, before that's dropped
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data)
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    fs.writeFileSync(marketPhotoPath(photoId), full.data);
    fs.writeFileSync(marketThumbPath(photoId), thumb);
    return {
      width: full.info.width,
      height: full.info.height,
      size: full.data.length + thumb.length,
    };
  });
}

export function deleteMarketPhotoFiles(photoId) {
  fs.rmSync(marketPhotoPath(photoId), { force: true });
  fs.rmSync(marketThumbPath(photoId), { force: true });
}
