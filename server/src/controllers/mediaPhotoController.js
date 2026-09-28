import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import config from '../config.js';
import MediaPhoto from '../models/mediaPhotoModel.js';
import { byTakenAt, thumbRelPath } from '../photos/imageFiles.js';
import { mediaThumbDir } from '../photos/mediaPhotoSync.js';
import { discoveryStatus, startDiscovery } from '../photos/discovery.js';

// Média → Fotók (members only - see mediaRoutes.js). The categories and
// photos are what "Új média felfedezése" last recorded (MediaPhoto); the
// files themselves are streamed from MEDIA_PHOTOS_ROOT.

// "sinners" -> "Sinners": the folder's name is the category's title.
const titleOf = (category) => category.charAt(0).toUpperCase() + category.slice(1);

// GET /media/photos - every category with its photos, in the order taken.
export const listMediaPhotos = async (req, res) => {
  const photos = await MediaPhoto.find().select('category filename width height takenAt').lean();
  const byCategory = new Map();
  for (const p of photos.sort(byTakenAt)) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push({
      filename: p.filename,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt,
    });
  }
  const categories = [...byCategory.entries()]
    .map(([key, list]) => ({ key, title: titleOf(key), photos: list }))
    .sort((a, b) => a.title.localeCompare(b.title, 'hu'));
  res.status(200).json({ status: 'success', data: { categories } });
};

// Only a recorded photo is ever served, and only from inside its folder -
// never trust the address alone.
async function ensureRecorded(category, filename) {
  if (!(await MediaPhoto.exists({ category, filename }))) {
    throw new AppError('Nincs ilyen fénykép.', 404);
  }
}

function insideRoot(root, relPath) {
  const base = path.resolve(root);
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) throw new AppError('Érvénytelen útvonal.', 400);
  return full;
}

function sendOriginal(res, category, filename, { download = false } = {}) {
  const full = insideRoot(path.join(config.mediaPhotosRoot, category), filename);
  if (!fs.existsSync(full)) throw new AppError('A fénykép nem található a lemezen.', 404);
  if (download) return res.download(full, path.basename(filename));
  res.sendFile(full);
}

// GET /media/photos/:category/:filename - the original.
export const getMediaPhoto = async (req, res) => {
  const { category, filename } = req.params;
  await ensureRecorded(category, filename);
  sendOriginal(res, category, filename);
};

// GET /media/photos/:category/:filename/download - the same original as a
// download (Content-Disposition: attachment) - the viewer's download
// button; a plain <a download> doesn't work across the client's and the
// API's subdomains (same as tourImageController.js's).
export const downloadMediaPhoto = async (req, res) => {
  const { category, filename } = req.params;
  await ensureRecorded(category, filename);
  sendOriginal(res, category, filename, { download: true });
};

// GET /media/photos/:category/:filename/thumb - the small .webp, or the
// original if the thumbnail is missing.
export const getMediaPhotoThumb = async (req, res) => {
  const { category, filename } = req.params;
  await ensureRecorded(category, filename);
  const thumb = insideRoot(mediaThumbDir(category), thumbRelPath(filename));
  if (fs.existsSync(thumb)) return res.sendFile(thumb);
  sendOriginal(res, category, filename);
};

// POST /media/discover (admin) - starts "Új média felfedezése" in the
// background; GET /media/discover - how it's going / what it found.
export const startMediaDiscovery = (req, res) => {
  const started = startDiscovery(req.user.name);
  res.status(started ? 202 : 409).json({ status: 'success', data: discoveryStatus() });
};

export const getMediaDiscovery = (req, res) => {
  res.status(200).json({ status: 'success', data: discoveryStatus() });
};
