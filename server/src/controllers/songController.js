import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Song from '../models/songModel.js';
import SongList from '../models/songListModel.js';
import User from '../models/userModel.js';
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
import { givenName } from '../utils/birthday.js';

// Daloskönyv: the club's songbook. Reading is for everyone logged in, and
// so is adding a song: whoever adds one owns it, and may change and delete
// that one. The book's keeper - the one role manager
// (utils/roleManager.js) - may change every song, and only the keeper's
// songs are the book itself (`inBook`: its PDF, its count, its index);
// the others' are listed in the app beside them, each with its owner's
// name, until the keeper takes one in.
export const canEditSongs = (user) => !!user?.canManageRoles;

// A song without an owner (from before owners) is the keeper's.
export const canEditSong = (user, song) =>
  canEditSongs(user) || (!!song.owner && !!user && String(ownerId(song)) === String(user._id));

// The owner's id, whether the song carries the id or the user itself.
const ownerId = (song) => song.owner?._id ?? song.owner;

// The songs of the book itself: `inBook` - and the ones from before that
// field, which have none.
const IN_BOOK = { inBook: { $ne: false } };
const isInBook = (song) => song.inBook !== false;

// What a song says of its owner and of who is asking. ownerName: the
// owner's given name ("Melinda") on a song that isn't the book's - the tag
// it carries in the list; '' on the book's own songs.
function ownership(song, user) {
  const inBook = isInBook(song);
  const owner = song.owner && typeof song.owner === 'object' && 'name' in song.owner;
  return {
    inBook,
    ownerName: !inBook && owner ? givenName(song.owner) : '',
    canEdit: canEditSong(user, song),
  };
}

const OWNER_FIELDS = 'name firstName lastName';

// The table of contents needs no lyrics - but the songs' keys are worked
// out from their chords (detectedKey below), so the text is read too.
const LIST_FIELDS = 'title artist slug key chordpro createdAt updatedAt owner inBook';

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
// And with whose it is (`ownership` above) - the owner itself isn't sent,
// only the name the list shows.
function songView(song, user) {
  const { updatedBy: _updatedBy, owner: _owner, __v, ...fields } = song.toObject();
  return { ...fields, detectedKey: detectedKey(song), ...ownership(song, user) };
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

// GET /songs - the table of contents: no lyrics. Every song there is - the
// book's own and the ones others added, each saying which it is, whose,
// and whether the one asking may change it. canEdit: the one asking is
// the book's keeper (every song is theirs to change). lastChanged: when a
// song was last added or changed (null without songs) - the book's date
// on the Dokumentumok card.
// One visit to the songbook: the list asked for again within this long is
// the same visit (an evening of singing) - after it, a new one begins.
const VISIT_MS = 12 * 60 * 60 * 1000;

// Since when a song is new to this user: since their visit before this one
// began. The list being asked for is the visit: the first time after a
// break begins a new one, and the one until then becomes "the one before".
// Someone's first visit ever has nothing new - not the whole book.
async function newSongsSince(user) {
  const now = new Date();
  if (user.songsSeenAt && now - user.songsSeenAt <= VISIT_MS) {
    return user.songsSeenBefore ?? user.songsSeenAt;
  }
  const before = user.songsSeenAt ?? now;
  await User.updateOne({ _id: user._id }, { songsSeenAt: now, songsSeenBefore: before });
  return before;
}

export const getSongs = async (req, res) => {
  const [songs, last, since] = await Promise.all([
    inBookOrder(Song.find().select(LIST_FIELDS).populate('owner', OWNER_FIELDS)),
    Song.findOne().sort('-updatedAt').select('updatedAt'),
    newSongsSince(req.user),
  ]);
  // Someone else's song, added since: one's own is no news.
  const isNew = (song) =>
    song.createdAt > since && String(song.owner?._id ?? song.owner ?? '') !== String(req.user._id);
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
        isNew: isNew(song),
        ...ownership(song, req.user),
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
  const song = await Song.findOne({ slug: req.params.slug }).populate('owner', OWNER_FIELDS);
  if (!song) throw new AppError('Nincs ilyen dal.', 404);
  res.status(200).json({ status: 'success', data: { song: songView(song, req.user) } });
};

// The finished PDFs, by what was asked for ("guitar|A4") - kept until a
// song is added, changed or deleted (its `version` says so), since
// drawing the whole book takes a second or two.
const bookCache = new Map();

// The book as it is now, drawn the way the request asks (?diagrams, ?size).
async function currentBook(query) {
  const diagrams = BOOK_DIAGRAMS.includes(query.diagrams) ? query.diagrams : null;
  const size = BOOK_SIZES.includes(query.size) ? query.size : 'A4';

  // The book's own songs only - not the ones others added beside it.
  const [count, newest, lastChanged] = await Promise.all([
    Song.countDocuments(IN_BOOK),
    Song.findOne(IN_BOOK).sort('-createdAt').select('createdAt'),
    Song.findOne(IN_BOOK).sort('-updatedAt').select('updatedAt'),
  ]);
  if (!count) throw new AppError('Még nincs dal a daloskönyvben.', 404);

  const key = `${diagrams}|${size}`;
  const version = `${count}|${newest._id}|${lastChanged.updatedAt.getTime()}`;
  let book = bookCache.get(key);
  if (book?.version !== version) {
    const songs = await inBookOrder(
      Song.find(IN_BOOK).select('title artist chordpro key tempo'),
    ).lean();
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
// The cover's look (songs/songBookCover.js), counted: one more whenever it
// is drawn another way, so the pictures kept of the old one are made anew.
const COVER_LOOK = 2;

// GET /songs/book.webp - the book's cover as a small picture, for its card
// on Klub → Dokumentumok (made like a club document's preview, and kept
// beside those). Only the cover is drawn for it, not the book - and only
// when what the cover says has changed: the number of songs, whose
// diagrams, the day the newest song came in - or the cover's own look
// (COVER_LOOK). Correcting a song's chords doesn't touch it.
export const getSongBookPreview = async (req, res) => {
  const diagrams = BOOK_DIAGRAMS.includes(req.query.diagrams) ? req.query.diagrams : null;
  const [count, newest] = await Promise.all([
    Song.countDocuments(IN_BOOK),
    Song.findOne(IN_BOOK).sort('-createdAt').select('createdAt'),
  ]);
  if (!count) throw new AppError('Még nincs dal a daloskönyvben.', 404);

  const kind = `daloskonyv-${diagrams ?? 'none'}`;
  const name = `${kind}-${COVER_LOOK}-${count}-${budapestYmd(newest.createdAt)}.webp`;
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

// The song with its owner's name read in, as it is sent back.
async function sent(song, user) {
  await song.populate('owner', OWNER_FIELDS);
  return songView(song, user);
}

// May this user change this song? 403 if not.
function assertMayEdit(user, song) {
  if (!canEditSong(user, song)) {
    throw new AppError('Ezt a dalt csak az módosíthatja, aki felvette.', 403);
  }
}

// POST /songs - anyone logged in. The song is theirs; the keeper's goes
// into the book, anyone else's stands beside it.
export const createSong = async (req, res) => {
  const fields = songFields(req.body);
  const song = await Song.create({
    ...fields,
    slug: await Song.freeSlug(fields.title),
    owner: req.user._id,
    inBook: canEditSongs(req.user),
    updatedBy: req.user._id,
  });
  res.status(201).json({ status: 'success', data: { song: await sent(song, req.user) } });
};

// PATCH /songs/:id - a new title gets a new slug (the song's address). A
// key set by hand holds only until the song's chords are next changed:
// new chords without a key sent with them drop it, and the key is the one
// the chords say again. Only the song's owner and the book's keeper; and
// only the keeper says whether a song is the book's (`inBook`). A song
// taken into the book becomes the keeper's own, like every song of the
// book: who added it can no longer change it. Taken out again, it stays
// the keeper's.
export const updateSong = async (req, res) => {
  const song = await findSong(req.params.id);
  assertMayEdit(req.user, song);
  const fields = songFields(req.body, { partial: true });
  if (req.body.inBook !== undefined) {
    if (!canEditSongs(req.user)) {
      throw new AppError('A daloskönyvbe csak a gazdája vehet fel dalt.', 403);
    }
    fields.inBook = req.body.inBook === true;
    if (fields.inBook) fields.owner = req.user._id;
  }
  if (fields.title && fields.title !== song.title) {
    song.slug = await Song.freeSlug(fields.title, song._id);
  }
  const newChords =
    fields.chordpro !== undefined &&
    chordSignature(fields.chordpro) !== chordSignature(song.chordpro ?? '');
  if (newChords && fields.key === undefined) fields.key = '';
  song.set({ ...fields, updatedBy: req.user._id });
  await song.save();
  res.status(200).json({ status: 'success', data: { song: await sent(song, req.user) } });
};

// DELETE /songs/:id - the song's owner, or the book's keeper.
export const deleteSong = async (req, res) => {
  const song = await findSong(req.params.id);
  assertMayEdit(req.user, song);
  await song.deleteOne();
  // Out of every playlist it stood in, whoever's.
  await SongList.updateMany({ songs: song._id }, { $pull: { songs: song._id } });
  res.status(204).send();
};
