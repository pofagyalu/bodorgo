import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import config from '../config.js';
import MediaPhoto from '../models/mediaPhotoModel.js';
import MediaPhotoSettings from '../models/mediaPhotoSettingsModel.js';
import { canEditMedia, maySee, ownSettingsFrom, saveOwnSettings } from '../utils/mediaAccess.js';
import { byTakenAt, thumbRelPath } from '../photos/imageFiles.js';
import { mediaThumbDir } from '../photos/mediaPhotoSync.js';
import { LONG_CACHE, requestedWidth, sendPhoto } from '../photos/imageSizes.js';
import { discoveryStatus, startDiscovery } from '../photos/discovery.js';
import { newMark } from '../utils/newMedia.js';

// Média → Fotók (members only - see mediaRoutes.js). The categories and
// photos are what "Új média felfedezése" last recorded (MediaPhoto); the
// files themselves are streamed from MEDIA_PHOTOS_ROOT. The role manager may give a
// photo a name (it has none otherwise - the file's is never shown) and say
// who may see it (MediaPhotoSettings) - anyone else (but an admin) doesn't
// get it in the list, and can't fetch it either.

// "sinners" -> "Sinners": the folder's name is the category's title.
const titleOf = (category) => category.charAt(0).toUpperCase() + category.slice(1);

// GET /media/photos - every category with its photos, in the order taken.
// A category with no photo this user may see is left out.
export const listMediaPhotos = async (req, res) => {
  const canEdit = canEditMedia(req.user);
  // What was set for them, by "category/filename".
  const settings = new Map(
    (await MediaPhotoSettings.find().lean()).map((s) => [`${s.category}/${s.filename}`, s]),
  );
  const photos = await MediaPhoto.find()
    .select('category filename width height takenAt addedAt')
    .lean();
  const byCategory = new Map();
  for (const p of photos.sort(byTakenAt)) {
    const own = settings.get(`${p.category}/${p.filename}`);
    if (!maySee(req.user, own)) continue;
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push({
      filename: p.filename,
      // The name it was given - null: it has none.
      title: own?.title || null,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt,
      // An admin: "Új" on what a discovery has just brought.
      ...newMark(req.user, p.addedAt),
      // Who may see it (empty: every member) - only the one who sets it is
      // told.
      ...(canEdit ? { viewers: (own?.viewers ?? []).map(String) } : {}),
    });
  }
  const categories = [...byCategory.entries()]
    .map(([key, list]) => ({ key, title: titleOf(key), photos: list }))
    .sort((a, b) => a.title.localeCompare(b.title, 'hu'));
  res.status(200).json({ status: 'success', data: { categories } });
};

// PATCH /media/photos/:category/:filename - the role manager: the photo's name and
// who may see it. Only what is sent changes. An empty title leaves the
// photo without a name; an empty viewers list gives it back to every
// member.
export const updateMediaPhoto = async (req, res) => {
  const { category, filename } = req.params;
  if (!(await MediaPhoto.exists({ category, filename }))) {
    throw new AppError('Nincs ilyen fénykép.', 404);
  }
  const own = await MediaPhotoSettings.findOne({ category, filename }).lean();
  const { title, viewers } = await ownSettingsFrom(req.body, own, '');
  await saveOwnSettings(MediaPhotoSettings, { category, filename }, { title, viewers });
  res.status(200).json({
    status: 'success',
    data: { photo: { filename, title: title || null, viewers } },
  });
};

// Only a recorded photo is ever served, and only from inside its folder -
// never trust the address alone. A photo kept for others is, to this user,
// not there.
async function ensureRecorded(req) {
  const { category, filename } = req.params;
  if (
    !(await MediaPhoto.exists({ category, filename })) ||
    !maySee(req.user, await MediaPhotoSettings.findOne({ category, filename }).lean())
  ) {
    throw new AppError('Nincs ilyen fénykép.', 404);
  }
}

function insideRoot(root, relPath) {
  const base = path.resolve(root);
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) throw new AppError('Érvénytelen útvonal.', 400);
  return full;
}

const originalPath = (category, filename) =>
  insideRoot(path.join(config.mediaPhotosRoot, category), filename);

// GET /media/photos/:category/:filename - the original; ?w=800/1200/1920 -
// a smaller WebP of it instead (see photos/imageSizes.js), what the viewer
// asks for.
export const getMediaPhoto = async (req, res) => {
  const { category, filename } = req.params;
  const width = requestedWidth(req.query);
  await ensureRecorded(req);
  await sendPhoto(res, originalPath(category, filename), {
    key: `media/${category}`,
    filename,
    width,
  });
};

// GET /media/photos/:category/:filename/download - the same original as a
// download (Content-Disposition: attachment) - the viewer's download
// button; a plain <a download> doesn't work across the client's and the
// API's subdomains (same as tourImageController.js's).
export const downloadMediaPhoto = async (req, res) => {
  const { category, filename } = req.params;
  await ensureRecorded(req);
  const full = originalPath(category, filename);
  if (!fs.existsSync(full)) throw new AppError('A fénykép nem található a lemezen.', 404);
  res.download(full, path.basename(filename));
};

// GET /media/photos/:category/:filename/thumb - the small .webp, or the
// original if the thumbnail is missing.
export const getMediaPhotoThumb = async (req, res) => {
  const { category, filename } = req.params;
  await ensureRecorded(req);
  const thumb = insideRoot(mediaThumbDir(category), thumbRelPath(filename));
  if (fs.existsSync(thumb)) {
    res.set('Cache-Control', LONG_CACHE);
    return res.sendFile(thumb);
  }
  await sendPhoto(res, originalPath(category, filename), {});
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
