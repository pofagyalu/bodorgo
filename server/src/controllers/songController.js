import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Song from '../models/songModel.js';
import AppError from '../utils/appError.js';
import {
  BOOK_DIAGRAMS,
  BOOK_SIZES,
  renderSongBook,
  renderSongBookCover,
} from '../songs/songBook.js';
import { DOCUMENT_PREVIEWS_DIR, pdfFirstPagePreview } from '../utils/documentPreviews.js';
import { budapestYmd } from '../utils/huDate.js';

// Daloskönyv: the club's songbook. Reading is for everyone logged in;
// writing only for the one role manager (utils/roleManager.js) - the
// client's twin: auth/song-edit.guard.ts.
export const canEditSongs = (user) => !!user?.canManageRoles;

// After requireAuth.
export function requireSongEditor(req, res, next) {
  if (!canEditSongs(req.user)) {
    return next(new AppError('A daloskönyvet csak a gazdája szerkesztheti.', 403));
  }
  next();
}

const LIST_FIELDS = 'title artist slug';

// The book's order: by title, the Hungarian way (á with a, ö after o...).
const inBookOrder = (query) => query.collation({ locale: 'hu' }).sort('title');

// What a song's form may set.
function songFields(body, { partial = false } = {}) {
  const fields = {};
  if (!partial || body.title !== undefined) {
    fields.title = String(body.title ?? '').trim();
    if (!fields.title) throw new AppError('A dalnak kell legyen címe.', 400);
  }
  if (body.artist !== undefined) fields.artist = String(body.artist ?? '').trim();
  if (body.chordpro !== undefined) {
    fields.chordpro = String(body.chordpro ?? '').replace(/\r\n?/g, '\n');
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) throw new AppError('A címkék listája hibás.', 400);
    fields.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
  }
  if (body.originalKey !== undefined) {
    fields.originalKey = String(body.originalKey ?? '').trim();
    if (fields.originalKey.length > 12) throw new AppError('Az eredeti hangnem túl hosszú.', 400);
  }
  return fields;
}

async function findSong(id) {
  const song = mongoose.isValidObjectId(id) ? await Song.findById(id) : null;
  if (!song) throw new AppError('Nincs ilyen dal.', 404);
  return song;
}

// GET /songs - the table of contents: no lyrics. lastChanged: when a song
// was last added or changed (null without songs) - the book's date on the
// Dokumentumok card.
export const getSongs = async (req, res) => {
  const [songs, last] = await Promise.all([
    inBookOrder(Song.find().select(LIST_FIELDS)),
    Song.findOne().sort('-updatedAt').select('updatedAt'),
  ]);
  res.status(200).json({
    status: 'success',
    data: { songs, canEdit: canEditSongs(req.user), lastChanged: last?.updatedAt ?? null },
  });
};

// GET /songs/:slug - one song, whole.
export const getSong = async (req, res) => {
  const song = await Song.findOne({ slug: req.params.slug }).select('-updatedBy -__v');
  if (!song) throw new AppError('Nincs ilyen dal.', 404);
  res.status(200).json({ status: 'success', data: { song } });
};

// The finished PDFs, by what was asked for ("guitar|A4") - kept until a
// song is added, changed or deleted (its `version` says so), since
// drawing the whole book takes a second or two.
const bookCache = new Map();

// The book as it is now, drawn the way the request asks (?diagrams, ?size).
async function currentBook(query) {
  const diagrams = BOOK_DIAGRAMS.includes(query.diagrams) ? query.diagrams : null;
  const size = BOOK_SIZES.includes(query.size) ? query.size : 'A4';

  const [count, newest, lastChanged] = await Promise.all([
    Song.countDocuments(),
    Song.findOne().sort('-createdAt').select('createdAt'),
    Song.findOne().sort('-updatedAt').select('updatedAt'),
  ]);
  if (!count) throw new AppError('Még nincs dal a daloskönyvben.', 404);

  const key = `${diagrams}|${size}`;
  const version = `${count}|${newest._id}|${lastChanged.updatedAt.getTime()}`;
  let book = bookCache.get(key);
  if (book?.version !== version) {
    const songs = await inBookOrder(Song.find().select('title artist chordpro')).lean();
    // The cover's "edition": the day the newest song came in.
    const pdf = await renderSongBook(songs, { diagrams, size, lastAdded: newest.createdAt });
    book = { version, pdf };
    bookCache.set(key, book);
  }
  return book;
}

// GET /songs/book.pdf?diagrams=guitar|ukulele&size=A4|A5&download=1 - the
// whole songbook (songs/songBook.js).
export const getSongBook = async (req, res) => {
  const book = await currentBook(req.query);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${req.query.download ? 'attachment' : 'inline'}; filename="bodorgo-daloskonyv.pdf"`,
  );
  // Asked again each time (the cookie decides who may), never stored.
  res.setHeader('Cache-Control', 'private, no-cache');
  res.send(book.pdf);
};

// The cover's small pictures already read from the disk, by file name.
const coverPreviews = new Map();

// GET /songs/book.webp - the book's cover as a small picture, for its card
// on Klub → Dokumentumok (made like a club document's preview, and kept
// beside those). Only the cover is drawn for it, not the book - and only
// when what the cover says has changed: the number of songs, whose
// diagrams, or the day the newest song came in. Correcting a song's
// chords doesn't touch it.
export const getSongBookPreview = async (req, res) => {
  const diagrams = BOOK_DIAGRAMS.includes(req.query.diagrams) ? req.query.diagrams : null;
  const [count, newest] = await Promise.all([
    Song.countDocuments(),
    Song.findOne().sort('-createdAt').select('createdAt'),
  ]);
  if (!count) throw new AppError('Még nincs dal a daloskönyvben.', 404);

  const kind = `daloskonyv-${diagrams ?? 'none'}`;
  const name = `${kind}-${count}-${budapestYmd(newest.createdAt)}.webp`;
  let preview = coverPreviews.get(name);
  if (!preview) {
    const file = path.join(DOCUMENT_PREVIEWS_DIR, name);
    if (fs.existsSync(file)) {
      preview = fs.readFileSync(file);
    } else {
      const cover = await renderSongBookCover({ count, diagrams, lastAdded: newest.createdAt });
      preview = await pdfFirstPagePreview(cover);
      // The earlier covers of this kind are of no use any more.
      fs.mkdirSync(DOCUMENT_PREVIEWS_DIR, { recursive: true });
      for (const old of fs.readdirSync(DOCUMENT_PREVIEWS_DIR)) {
        if (!old.startsWith(`${kind}-`)) continue;
        fs.rmSync(path.join(DOCUMENT_PREVIEWS_DIR, old));
        coverPreviews.delete(old);
      }
      fs.writeFileSync(file, preview);
    }
    coverPreviews.set(name, preview);
  }

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.send(preview);
};

// POST /songs
export const createSong = async (req, res) => {
  const fields = songFields(req.body);
  const song = await Song.create({
    ...fields,
    slug: await Song.freeSlug(fields.title),
    updatedBy: req.user._id,
  });
  res.status(201).json({ status: 'success', data: { song } });
};

// PATCH /songs/:id - a new title gets a new slug (the song's address).
export const updateSong = async (req, res) => {
  const song = await findSong(req.params.id);
  const fields = songFields(req.body, { partial: true });
  if (fields.title && fields.title !== song.title) {
    song.slug = await Song.freeSlug(fields.title, song._id);
  }
  song.set({ ...fields, updatedBy: req.user._id });
  await song.save();
  res.status(200).json({ status: 'success', data: { song } });
};

// DELETE /songs/:id
export const deleteSong = async (req, res) => {
  const song = await findSong(req.params.id);
  await song.deleteOne();
  res.status(204).send();
};
