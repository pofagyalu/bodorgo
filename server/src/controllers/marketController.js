import fs from 'fs';
import mongoose from 'mongoose';
import multer from 'multer';
import User from '../models/userModel.js';
import MarketItem, {
  CATEGORIES,
  MAX_NOTE_LENGTH,
  MAX_PHOTOS,
  PRICE_KINDS,
} from '../models/marketItemModel.js';
import AppError from '../utils/appError.js';
import logger from '../logger.js';
import { pushInBackground } from '../chat/chatNotifications.js';
import {
  deleteMarketPhotoFiles,
  marketPhotoPath,
  marketThumbPath,
  saveMarketPhoto,
} from '../marketplace/marketPhotos.js';
import {
  HOLD_DAYS,
  ITEM_POPULATE,
  holdUntil,
  itemView,
  priceLabel,
} from '../marketplace/marketItems.js';

// Ócskapiac - see models/marketItemModel.js. Anyone logged in (guests too)
// may give things away, ask for them and leave a note; changing or
// deleting an item is its owner's (deleting: an admin's too).

// The phone shrinks the photos first, so this is just a generous ceiling.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_PHOTOS },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new AppError('Csak kép tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).array('photos', MAX_PHOTOS);

// multer's own errors as messages the page can show.
export const marketPhotoUpload = (req, res, next) =>
  upload(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Túl nagy a kép (legfeljebb 12 MB).', 400));
    }
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError(`Legfeljebb ${MAX_PHOTOS} fotó lehet.`, 400));
    }
    next(err);
  });

const refId = (ref) => String(ref?._id ?? ref);
const isOwner = (item, user) => refId(item.owner) === refId(user);

async function loadItem(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Nincs ilyen kacat.', 404);
  const item = await MarketItem.findById(id);
  // One its owner deleted is kept, but for nobody to see.
  if (!item || item.deletedAt) throw new AppError('Nincs ilyen kacat.', 404);
  return item;
}

async function viewOf(item, user) {
  await item.populate(ITEM_POPULATE);
  return itemView(item, user);
}

const notGone = (item) => {
  if (item.goneAt) throw new AppError('Ezt már elvitték.', 400);
};

// The text fields of a new or changed item (multipart: all strings).
// `partial`: only what was sent is checked and returned.
function readFields(body, partial) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('title')) {
    const title = String(body.title ?? '').trim();
    if (!title) throw new AppError('Adj nevet a kacatnak.', 400);
    if (title.length > 80) throw new AppError('A név legfeljebb 80 karakter lehet.', 400);
    out.title = title;
  }
  if (!partial || has('description')) {
    const description = String(body.description ?? '').trim();
    if (description.length > 1000) throw new AppError('A leírás legfeljebb 1000 karakter.', 400);
    out.description = description;
  }
  if (!partial || has('category')) {
    const category = String(body.category || 'egyeb');
    if (!CATEGORIES.includes(category)) throw new AppError('Ismeretlen kategória.', 400);
    out.category = category;
  }
  if (!partial || has('priceKind') || has('priceAmount')) {
    const kind = String(body.priceKind || 'ingyen');
    if (!PRICE_KINDS.includes(kind)) throw new AppError('Ismeretlen ár.', 400);
    let amount = null;
    if (kind !== 'ingyen' && kind !== 'joszo') {
      amount = Number(body.priceAmount);
      const max = kind === 'forint' ? 1_000_000 : 99;
      if (!Number.isInteger(amount) || amount < 1 || amount > max) {
        throw new AppError(`Az ár 1 és ${max.toLocaleString('hu-HU')} közötti egész szám.`, 400);
      }
    }
    out.price = { kind, amount };
  }
  return out;
}

// Each uploaded photo made into WebP files; on a bad one, the ones already
// written go again.
async function savePhotos(files) {
  const saved = [];
  try {
    for (const file of files) {
      const _id = new mongoose.Types.ObjectId();
      saved.push({ _id, ...(await saveMarketPhoto(_id, file.buffer)) });
    }
  } catch (err) {
    saved.forEach((p) => deleteMarketPhotoFiles(p._id));
    logger.warn(`Ócskapiac photo could not be read: ${err.message}`);
    throw new AppError('Valamelyik fájl nem kép, vagy nem olvasható.', 400);
  }
  return saved;
}

const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).map(String);

// GET /ocskapiac - everything, what went (Odaadtam) too: nothing is let go
// - there won't be that many.
// Opening it counts as seeing what's new (the menu's badge, getNewCount).
export const getMarketItems = async (req, res) => {
  const items = await MarketItem.find({ deletedAt: null })
    .sort({ createdAt: -1 })
    .populate(ITEM_POPULATE);
  await User.updateOne({ _id: req.user._id }, { marketSeenAt: new Date() });
  res.status(200).json({
    status: 'success',
    data: { items: items.map((i) => itemView(i, req.user)) },
  });
};

// GET /ocskapiac/new-count - the menu's badge: what others put up since I
// last opened the Ócskapiac (everything still on offer, if I never did).
export const getNewCount = async (req, res) => {
  const count = await MarketItem.countDocuments({
    owner: { $ne: req.user._id },
    deletedAt: null,
    goneAt: null,
    ...(req.user.marketSeenAt && { createdAt: { $gt: req.user.marketSeenAt } }),
  });
  res.status(200).json({ status: 'success', data: { count } });
};

// GET /ocskapiac/:id
export const getMarketItem = async (req, res) => {
  const item = await loadItem(req.params.id);
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

// POST /ocskapiac - multipart: title, description, category, priceKind,
// priceAmount, photos (1-3).
export const createMarketItem = async (req, res) => {
  const fields = readFields(req.body ?? {}, false);
  const files = req.files ?? [];
  if (!files.length) throw new AppError('Legalább egy fotó kell róla.', 400);
  const photos = await savePhotos(files);
  const item = await MarketItem.create({ ...fields, owner: req.user._id, photos });
  announceNewItem(item, req.user).catch((err) =>
    logger.error(`Ócskapiac new-item push failed: ${err.message}`),
  );
  res.status(201).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

// PATCH /ocskapiac/:id (owner) - multipart: any of the fields, new photos,
// removePhotos (ids, repeatable).
export const updateMarketItem = async (req, res) => {
  const item = await loadItem(req.params.id);
  if (!isOwner(item, req.user)) throw new AppError('Csak a saját kacatodat módosíthatod.', 403);
  notGone(item);
  const fields = readFields(req.body ?? {}, true);

  const remove = new Set(asList(req.body?.removePhotos));
  const kept = item.photos.filter((p) => !remove.has(refId(p)));
  const files = req.files ?? [];
  if (kept.length + files.length > MAX_PHOTOS) {
    throw new AppError(`Legfeljebb ${MAX_PHOTOS} fotó lehet.`, 400);
  }
  if (kept.length + files.length === 0) throw new AppError('Legalább egy fotó kell róla.', 400);
  const added = await savePhotos(files);
  const removed = item.photos.filter((p) => remove.has(refId(p)));

  Object.assign(item, fields);
  item.photos = [...kept, ...added];
  await item.save();
  removed.forEach((p) => deleteMarketPhotoFiles(p._id));
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

// DELETE /ocskapiac/:id - an admin: for real, photos and all; its owner:
// only marked deleted (kept, photos too, for later - nobody sees it).
export const deleteMarketItem = async (req, res) => {
  const item = await loadItem(req.params.id);
  if (req.user.role === 'admin') {
    item.photos.forEach((p) => deleteMarketPhotoFiles(p._id));
    await item.deleteOne();
  } else if (isOwner(item, req.user)) {
    item.deletedAt = new Date();
    await item.save();
  } else {
    throw new AppError('Csak a saját kacatodat törölheted.', 403);
  }
  res.status(204).end();
};

// POST /ocskapiac/:id/gone (owner) - "Odaadtam": it stays, photos and all,
// stamped "Elvitték!".
export const markMarketItemGone = async (req, res) => {
  const item = await loadItem(req.params.id);
  if (!isOwner(item, req.user)) throw new AppError('Csak a saját kacatodat adhatod oda.', 403);
  notGone(item);
  item.goneAt = new Date();
  await item.save();
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

const who = (user) => user.username || user.name;
const itemUrl = (item) => `/ocskapiac?kacat=${item._id}`;

// Something new on offer: a push to everyone (guests too) but whoever put
// it up and those who turned it off on Profilom. One tag for them all - a
// few put up one after the other replace each other on the phone.
async function announceNewItem(item, owner) {
  const ids = await User.distinct('_id', {
    _id: { $ne: owner._id },
    retired: { $ne: true },
    wantsMarketPush: { $ne: false },
  });
  pushInBackground(ids, {
    title: '🧺 Új kacat az Ócskapiacon',
    body: `${who(owner)}: ${item.title} · ${priceLabel(item.price)}`,
    tag: 'ocskapiac-uj',
    url: itemUrl(item),
    renotify: true,
  });
}

// POST /ocskapiac/:id/want - "Kérem!"; DELETE: changed my mind.
export const wantMarketItem = async (req, res) => {
  const item = await loadItem(req.params.id);
  notGone(item);
  if (isOwner(item, req.user)) throw new AppError('A sajátodat nem kérheted.', 400);
  if (!item.wanted.some((w) => refId(w.user) === refId(req.user))) {
    item.wanted.push({ user: req.user._id });
    await item.save();
    pushInBackground([item.owner], {
      title: '🙋 Kérik a kacatodat!',
      body: `${who(req.user)} kéri: ${item.title}`,
      tag: `ocskapiac-${item._id}`,
      url: itemUrl(item),
    });
  }
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

export const unwantMarketItem = async (req, res) => {
  const item = await loadItem(req.params.id);
  item.wanted = item.wanted.filter((w) => refId(w.user) !== refId(req.user));
  await item.save();
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

// POST /ocskapiac/:id/dibs - "Stipistopi!": mine for 7 days, if nobody
// else holds it. DELETE: "Mégse kell" - the holder lets it go.
export const dibsMarketItem = async (req, res) => {
  const item = await loadItem(req.params.id);
  notGone(item);
  if (isOwner(item, req.user)) throw new AppError('A sajátodat nem stipistopizhatod.', 400);
  if (holdUntil(item)) {
    if (refId(item.reservedBy) === refId(req.user)) {
      throw new AppError('Már a tiéd a stipistopi.', 409);
    }
    throw new AppError('Valaki már lestipistopizta.', 409);
  }
  item.reservedBy = req.user._id;
  item.reservedAt = new Date();
  await item.save();
  pushInBackground([item.owner], {
    title: '✋ Stipistopi!',
    body: `${who(req.user)} lefoglalta: ${item.title} - ${HOLD_DAYS} napja van elvinni.`,
    tag: `ocskapiac-${item._id}`,
    url: itemUrl(item),
    renotify: true,
  });
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

export const undibsMarketItem = async (req, res) => {
  const item = await loadItem(req.params.id);
  if (!holdUntil(item) || refId(item.reservedBy) !== refId(req.user)) {
    throw new AppError('Nem a tiéd a stipistopi.', 400);
  }
  item.reservedBy = null;
  item.reservedAt = null;
  await item.save();
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

// POST /ocskapiac/:id/notes - { text }: a one-liner, anyone.
export const addMarketNote = async (req, res) => {
  const item = await loadItem(req.params.id);
  notGone(item);
  const text = String(req.body?.text ?? '').trim();
  if (!text) throw new AppError('Írj valamit.', 400);
  if (text.length > MAX_NOTE_LENGTH) {
    throw new AppError(`Egy megjegyzés legfeljebb ${MAX_NOTE_LENGTH} karakter.`, 400);
  }
  item.notes.push({ user: req.user._id, text });
  await item.save();
  res.status(201).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

// DELETE /ocskapiac/:id/notes/:noteId - its writer's.
export const deleteMarketNote = async (req, res) => {
  const item = await loadItem(req.params.id);
  const note = item.notes.id(req.params.noteId);
  if (!note) throw new AppError('Nincs ilyen megjegyzés.', 404);
  if (refId(note.user) !== refId(req.user)) {
    throw new AppError('Csak a saját megjegyzésedet törölheted.', 403);
  }
  note.deleteOne();
  await item.save();
  res.status(200).json({ status: 'success', data: { item: await viewOf(item, req.user) } });
};

// GET /ocskapiac/:id/photos/:photoId (+ /thumb) - a photo of an item.
async function photoOf(req) {
  const item = await loadItem(req.params.id);
  const photo = item.photos.id(req.params.photoId);
  if (!photo) throw new AppError('Nincs ilyen fotó.', 404);
  return photo._id;
}

function send(res, file) {
  if (!fs.existsSync(file)) throw new AppError('Nincs ilyen fotó.', 404);
  // A photo never changes - a new one gets a new id.
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(file);
}

export const getMarketPhoto = async (req, res) => send(res, marketPhotoPath(await photoOf(req)));
export const getMarketThumb = async (req, res) => send(res, marketThumbPath(await photoOf(req)));
