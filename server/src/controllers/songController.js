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
  renderSongPdf,
} from '../songs/songBook.js';
import { chordSignature, detectKey, parseChord, plainLyrics } from '../songs/songText.js';
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

// The table of contents needs no lyrics - but the songs' keys are worked
// out from their chords (detectedKey below), so the text is read too.
const LIST_FIELDS = 'title artist slug key chordpro updatedAt';

// A song's key as its chords say (songs/songText.js's detectKey: "C",
// "am"; '' without chords) - remembered per song until the song changes.
const detectedKeys = new Map();

function detectedKey(song) {
  const id = String(song._id);
  const at = song.updatedAt?.getTime() ?? 0;
  let known = detectedKeys.get(id);
  if (known?.at !== at) {
    known = { at, key: detectKey(song.chordpro ?? '') };
    detectedKeys.set(id, known);
  }
  return known.key;
}

// A whole song as it is sent: with the key its chords say beside the one
// set by hand (`key`, '' while none is).
function songView(song) {
  const { updatedBy: _updatedBy, __v, ...fields } = song.toObject();
  return { ...fields, detectedKey: detectedKey(song) };
}

// The book's order: by title, the Hungarian way (á with a, ö after o...).
const inBookOrder = (query) => query.collation({ locale: 'hu' }).sort('title');

// A tempo's bounds, in beats a minute (the model's too).
const TEMPO_MIN = 30;
const TEMPO_MAX = 300;

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
  // The key set by hand, as its home chord ("C", "am") - '' leaves it to
  // the chords.
  if (body.key !== undefined) {
    fields.key = String(body.key ?? '').trim();
    if (fields.key && (fields.key.length > 12 || !parseChord(fields.key))) {
      throw new AppError('Ilyen hangnem nincs.', 400);
    }
  }
  // The tempo in beats a minute, a whole number - null (or '') for none.
  if (body.tempo !== undefined) {
    if (body.tempo === null || body.tempo === '') {
      fields.tempo = null;
    } else {
      fields.tempo = Number(body.tempo);
      if (!Number.isInteger(fields.tempo) || fields.tempo < TEMPO_MIN || fields.tempo > TEMPO_MAX) {
        throw new AppError(`A tempó ${TEMPO_MIN} és ${TEMPO_MAX} közötti egész szám lehet.`, 400);
      }
    }
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
    data: {
      songs: songs.map((song) => ({
        _id: song._id,
        title: song.title,
        artist: song.artist,
        slug: song.slug,
        key: song.key ?? '',
        detectedKey: detectedKey(song),
      })),
      canEdit: canEditSongs(req.user),
      lastChanged: last?.updatedAt ?? null,
    },
  });
};

// Each song's words line by line (songs/songText.js's plainLyrics) -
// remembered per song until the song changes.
const songWords = new Map();

function wordsOf(song) {
  const id = String(song._id);
  const at = song.updatedAt?.getTime() ?? 0;
  let known = songWords.get(id);
  if (known?.at !== at) {
    known = { at, lines: plainLyrics(song.chordpro ?? '') };
    songWords.set(id, known);
  }
  return known.lines;
}

// GET /songs/lyrics - every song's words alone (no chords, no labels), for
// the songbook's search to look through on the spot. One answer for the
// whole book, asked for once when the songbook opens - a few hundred kB of
// text, a quarter of that on the wire (app.js compresses it).
export const getLyrics = async (req, res) => {
  const songs = await Song.find().select('chordpro updatedAt');
  res.status(200).json({
    status: 'success',
    data: { lyrics: songs.map((song) => ({ _id: song._id, lines: wordsOf(song) })) },
  });
};

// GET /songs/:slug - one song, whole.
export const getSong = async (req, res) => {
  const song = await Song.findOne({ slug: req.params.slug });
  if (!song) throw new AppError('Nincs ilyen dal.', 404);
  res.status(200).json({ status: 'success', data: { song: songView(song) } });
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
    const songs = await inBookOrder(Song.find().select('title artist chordpro key tempo')).lean();
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

// GET /songs/:slug/pdf?diagrams=guitar|ukulele&size=A4|A5&transpose=2&download=1
// - one song alone, as its page of the book. transpose: semitones (-11…11)
// to move it by first - the song as the song page shows it then.
export const getSongPdf = async (req, res) => {
  const song = await Song.findOne({ slug: req.params.slug }).lean();
  if (!song) throw new AppError('Nincs ilyen dal.', 404);
  const diagrams = BOOK_DIAGRAMS.includes(req.query.diagrams) ? req.query.diagrams : null;
  const size = BOOK_SIZES.includes(req.query.size) ? req.query.size : 'A4';
  const steps = Number(req.query.transpose);
  const transpose = Number.isInteger(steps) && Math.abs(steps) < 12 ? steps : 0;

  const pdf = await renderSongPdf(song, { diagrams, size, transpose });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${req.query.download ? 'attachment' : 'inline'}; filename="${song.slug}.pdf"`,
  );
  res.setHeader('Cache-Control', 'private, no-cache');
  res.send(pdf);
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
  res.status(201).json({ status: 'success', data: { song: songView(song) } });
};

// PATCH /songs/:id - a new title gets a new slug (the song's address). A
// key set by hand holds only until the song's chords are next changed:
// new chords without a key sent with them drop it, and the key is the one
// the chords say again.
export const updateSong = async (req, res) => {
  const song = await findSong(req.params.id);
  const fields = songFields(req.body, { partial: true });
  if (fields.title && fields.title !== song.title) {
    song.slug = await Song.freeSlug(fields.title, song._id);
  }
  const newChords =
    fields.chordpro !== undefined &&
    chordSignature(fields.chordpro) !== chordSignature(song.chordpro ?? '');
  if (newChords && fields.key === undefined) fields.key = '';
  song.set({ ...fields, updatedBy: req.user._id });
  await song.save();
  res.status(200).json({ status: 'success', data: { song: songView(song) } });
};

// DELETE /songs/:id
export const deleteSong = async (req, res) => {
  const song = await findSong(req.params.id);
  await song.deleteOne();
  res.status(204).send();
};
