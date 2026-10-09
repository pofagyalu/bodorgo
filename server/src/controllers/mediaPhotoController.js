import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import config from '../config.js';
import MediaPhoto from '../models/mediaPhotoModel.js';
import MediaPhotoSettings from '../models/mediaPhotoSettingsModel.js';
import MediaPhotoFolder from '../models/mediaPhotoFolderModel.js';
import { canEditMedia, maySee, ownSettingsFrom, saveOwnSettings } from '../utils/mediaAccess.js';
import { byTakenAt, thumbRelPath } from '../photos/imageFiles.js';
import { mediaThumbDir } from '../photos/mediaPhotoSync.js';
import { LONG_CACHE, requestedWidth, sendPhoto } from '../photos/imageSizes.js';
import { discoveryStatus, startDiscovery } from '../photos/discovery.js';
import { newMark } from '../utils/newMedia.js';

// Média → Fotók (members only - see mediaRoutes.js). The categories and
// photos are what "Új média felfedezése" last recorded (MediaPhoto); the
// files themselves are streamed from MEDIA_PHOTOS_ROOT. A folder inside a
// category is an album of it: the list gives an album as a card (its name,
// cover and how many photos), its photos come when it is opened. The role
// manager may give a photo a name (it has none otherwise - the file's is
// never shown) and say who may see it (MediaPhotoSettings), and the same
// for a whole category or album, with an album's cover (MediaPhotoFolder) -
// anyone else (but an admin) doesn't get it in the list, and can't fetch
// it either.

// "sinners" -> "Sinners": the folder's name is the category's title.
const titleOf = (category) => category.charAt(0).toUpperCase() + category.slice(1);

// What was set for the folders, by "category/album" ("category/": the
// category itself).
async function folderSettings(filter = {}) {
  const folders = await MediaPhotoFolder.find(filter).lean();
  return new Map(folders.map((f) => [`${f.category}/${f.album ?? ''}`, f]));
}

// The photo is in a category, and maybe an album, this user may see.
const maySeeFolders = (user, folders, p) =>
  maySee(user, folders.get(`${p.category}/`)) &&
  (!p.album || maySee(user, folders.get(`${p.category}/${p.album}`)));

// A photo as the list gives it.
const photoFor = (user, canEdit, p, own) => ({
  filename: p.filename,
  // The name it was given - null: it has none.
  title: own?.title || null,
  width: p.width,
  height: p.height,
  takenAt: p.takenAt,
  // An admin: "Új" on what a discovery has just brought.
  ...newMark(user, p.addedAt),
  // Who may see it (empty: every member) - only the one who sets it is
  // told.
  ...(canEdit ? { viewers: (own?.viewers ?? []).map(String) } : {}),
});

// A folder's name and - for the one who sets it - who may see it.
const folderFor = (canEdit, own, discoveredTitle) => ({
  title: own?.title || discoveredTitle,
  discoveredTitle,
  ...(canEdit ? { viewers: (own?.viewers ?? []).map(String) } : {}),
});

// GET /media/photos - every category with its own photos, in the order
// taken, and its albums (newest first) without theirs. A category or album
// with no photo this user may see is left out.
export const listMediaPhotos = async (req, res) => {
  const canEdit = canEditMedia(req.user);
  // What was set for them, by "category/filename".
  const settings = new Map(
    (await MediaPhotoSettings.find().lean()).map((s) => [`${s.category}/${s.filename}`, s]),
  );
  const folders = await folderSettings();
  const photos = await MediaPhoto.find()
    .select('category album filename width height takenAt addedAt')
    .lean();
  const byCategory = new Map();
  for (const p of photos.sort(byTakenAt)) {
    const own = settings.get(`${p.category}/${p.filename}`);
    if (!maySee(req.user, own) || !maySeeFolders(req.user, folders, p)) continue;
    if (!byCategory.has(p.category)) byCategory.set(p.category, { photos: [], albums: new Map() });
    const category = byCategory.get(p.category);
    const photo = photoFor(req.user, canEdit, p, own);
    if (!p.album) category.photos.push(photo);
    else if (category.albums.has(p.album)) category.albums.get(p.album).push(photo);
    else category.albums.set(p.album, [photo]);
  }
  const categories = [...byCategory.entries()]
    .map(([key, { photos: own, albums }]) => {
      const albumList = [...albums.entries()]
        .map(([album, list]) => {
          const set = folders.get(`${key}/${album}`);
          const fresh = list.filter((p) => p.isNew).length;
          return {
            key: album,
            ...folderFor(canEdit, set, album),
            count: list.length,
            // The chosen one, if this user may see it - or the first.
            cover: list.some((p) => p.filename === set?.cover) ? set.cover : list[0].filename,
            ...(fresh ? { newCount: fresh } : {}),
          };
        })
        .sort((a, b) => b.key.localeCompare(a.key, 'hu', { numeric: true }));
      return {
        key,
        ...folderFor(canEdit, folders.get(`${key}/`), titleOf(key)),
        photos: own,
        albums: albumList,
        count: own.length + albumList.reduce((sum, a) => sum + a.count, 0),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'hu'));
  res.status(200).json({ status: 'success', data: { categories } });
};

// GET /media/photo-albums/:category/:album - the album's photos, in the
// order taken. One this user may see nothing of is, to them, not there.
export const listMediaAlbumPhotos = async (req, res) => {
  const { category, album } = req.params;
  const canEdit = canEditMedia(req.user);
  const folders = await folderSettings({ category, album: { $in: ['', album] } });
  const recorded = await MediaPhoto.find({ category, album })
    .select('category album filename width height takenAt addedAt')
    .lean();
  const settings = new Map(
    (await MediaPhotoSettings.find({ category }).lean()).map((s) => [s.filename, s]),
  );
  const photos = recorded
    .sort(byTakenAt)
    .filter(
      (p) => maySee(req.user, settings.get(p.filename)) && maySeeFolders(req.user, folders, p),
    )
    .map((p) => photoFor(req.user, canEdit, p, settings.get(p.filename)));
  if (!photos.length) throw new AppError('Nincs ilyen album.', 404);
  res.status(200).json({ status: 'success', data: { photos } });
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

// A folder's settings after a PATCH - only what is sent changes; the
// record goes when nothing is left to keep. An empty title (or the
// folder's own name) means the folder's name; an empty viewers list, every
// member; an empty cover, the album's first photo.
async function saveFolder(req, { category, album, discoveredTitle }) {
  const key = { category, album };
  const own = await MediaPhotoFolder.findOne(key).lean();
  const { title, viewers } = await ownSettingsFrom(req.body, own, discoveredTitle);
  let cover = own?.cover ?? '';
  if (album && req.body?.cover !== undefined) {
    cover = req.body.cover ?? '';
    if (typeof cover !== 'string') throw new AppError('A borító egy fénykép legyen.', 400);
    if (cover && !(await MediaPhoto.exists({ category, album, filename: cover }))) {
      throw new AppError('Nincs ilyen fénykép az albumban.', 400);
    }
  }
  if (!title && !viewers.length && !cover) await MediaPhotoFolder.deleteOne(key);
  else {
    const unset = { ...(title ? {} : { title: 1 }), ...(cover ? {} : { cover: 1 }) };
    await MediaPhotoFolder.findOneAndUpdate(
      key,
      {
        $set: { viewers, ...(title ? { title } : {}), ...(cover ? { cover } : {}) },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { upsert: true, runValidators: true },
    );
  }
  return { title: title || discoveredTitle, discoveredTitle, viewers, cover: cover || null };
}

// PATCH /media/photos/:category - the role manager: the category's name (instead
// of its folder's) and who may see it - all of it, its albums too.
export const updateMediaPhotoCategory = async (req, res) => {
  const { category } = req.params;
  if (!(await MediaPhoto.exists({ category }))) {
    throw new AppError('Nincs ilyen fotókategória.', 404);
  }
  const { title, discoveredTitle, viewers } = await saveFolder(req, {
    category,
    album: '',
    discoveredTitle: titleOf(category),
  });
  res.status(200).json({
    status: 'success',
    data: { category: { key: category, title, discoveredTitle, viewers } },
  });
};

// PATCH /media/photo-albums/:category/:album - the role manager: the album's name
// (instead of its folder's), who may see it, and the photo on its card.
export const updateMediaPhotoAlbum = async (req, res) => {
  const { category, album } = req.params;
  if (!(await MediaPhoto.exists({ category, album }))) {
    throw new AppError('Nincs ilyen album.', 404);
  }
  const saved = await saveFolder(req, { category, album, discoveredTitle: album });
  res.status(200).json({ status: 'success', data: { album: { key: album, ...saved } } });
};

// Only a recorded photo is ever served, and only from inside its folder -
// never trust the address alone. A photo kept for others - itself, or the
// category or album it is in - is, to this user, not there.
async function ensureRecorded(req) {
  const { category, filename } = req.params;
  const photo = await MediaPhoto.findOne({ category, filename }).select('category album').lean();
  if (
    !photo ||
    !maySee(req.user, await MediaPhotoSettings.findOne({ category, filename }).lean()) ||
    !maySeeFolders(
      req.user,
      await folderSettings({ category, album: { $in: ['', photo.album ?? ''] } }),
      photo,
    )
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
