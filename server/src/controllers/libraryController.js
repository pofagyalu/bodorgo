import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import multer from 'multer';
import AppError from '../utils/appError.js';
import { LibraryBook, LibraryPage } from '../models/libraryModels.js';
import {
  fold,
  pageImagePath,
  pageOpening,
  proposeToc,
  scanState,
  shelfFolders,
  shelfTitle,
  startScan,
  uploadTarget,
} from '../utils/libraryIndex.js';

// Média → Könyvtár: the owner's own PDF books on shelves - for the role
// manager (INITIAL_ADMIN_USER) alone, nobody else gets anything here. The
// files and how they are read: utils/libraryIndex.js.

const MAX_HITS = 60;

export const libraryOwnerOnly = (req, res, next) =>
  next(req.user?.canManageRoles ? undefined : new AppError('Nincs ilyen oldal.', 404));

// What a spine on the shelf needs.
const bookCard = (b) => ({
  _id: b._id,
  shelf: b.shelf,
  title: b.title,
  subtitle: b.subtitle ?? '',
  author: b.author ?? '',
  pages: b.pages,
  pageOffset: b.pageOffset,
  hasText: b.hasText,
});

async function bookOf(req) {
  const { id } = req.params;
  const book = mongoose.isValidObjectId(id) ? await LibraryBook.findById(id) : null;
  if (!book) throw new AppError('Nincs ilyen könyv.', 404);
  return book;
}

// GET /library - every shelf (an empty one too) with its books by title.
export const listLibrary = async (req, res) => {
  const books = await LibraryBook.find().select('-toc').lean();
  const shelves = shelfFolders().map((folder) => ({
    key: folder,
    title: shelfTitle(folder),
    books: books
      .filter((b) => b.shelf === folder)
      .sort((a, b) => a.title.localeCompare(b.title, 'hu'))
      .map(bookCard),
  }));
  res.status(200).json({ status: 'success', data: { shelves, scan: scanState() } });
};

// POST /library/scan - "Frissítés": reads the folders again in the
// background; GET /library tells how it is going.
export const scanLibrary = async (req, res) => {
  startScan();
  res.status(202).json({ status: 'success', data: { scan: scanState() } });
};

// GET /library/books/:id - the book with its table of contents.
export const getLibraryBook = async (req, res) => {
  const book = await bookOf(req);
  res.status(200).json({
    status: 'success',
    data: { book: { ...bookCard(book), filename: book.filename, toc: book.toc } },
  });
};

// PATCH /library/books/:id - its title, subtitle and author, the page
// numbers' shift, and the
// table of contents (then kept as the owner wrote it).
export const updateLibraryBook = async (req, res) => {
  const book = await bookOf(req);
  const { title, subtitle, author, pageOffset, toc } = req.body ?? {};

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      throw new AppError('A könyvnek kell legyen címe.', 400);
    }
    if (title.trim().length > 200) {
      throw new AppError('A cím legfeljebb 200 karakter lehet.', 400);
    }
    book.title = title.trim();
  }
  // Either may be emptied.
  for (const [field, value, name] of [
    ['subtitle', subtitle, 'Az alcím'],
    ['author', author, 'A szerző'],
  ]) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length > 200) {
      throw new AppError(`${name} legfeljebb 200 karakter lehet.`, 400);
    }
    book[field] = value.trim();
  }
  if (pageOffset !== undefined) {
    if (!Number.isInteger(pageOffset) || Math.abs(pageOffset) > 1000) {
      throw new AppError('Az oldalszám-eltolás egész szám legyen.', 400);
    }
    book.pageOffset = pageOffset;
  }
  if (toc !== undefined) {
    const ok =
      Array.isArray(toc) &&
      toc.length <= 2000 &&
      toc.every(
        (e) =>
          typeof e?.title === 'string' &&
          e.title.trim() &&
          e.title.trim().length <= 200 &&
          Number.isInteger(e.page) &&
          e.page >= 1 &&
          e.page <= book.pages &&
          (e.level === undefined || (Number.isInteger(e.level) && e.level >= 0 && e.level <= 3)),
      );
    if (!ok) throw new AppError('A tartalomjegyzék sorai: cím és létező oldalszám.', 400);
    book.toc = toc.map((e) => ({ title: e.title.trim(), page: e.page, level: e.level ?? 0 }));
    book.tocEdited = true;
  }
  await book.save();
  res.status(200).json({
    status: 'success',
    data: { book: { ...bookCard(book), filename: book.filename, toc: book.toc } },
  });
};

// GET /library/books/:id/pages/:page - that one page as a picture (WebP).
export const getLibraryPage = async (req, res) => {
  const book = await bookOf(req);
  const page = Number(req.params.page);
  if (!Number.isInteger(page) || page < 1 || page > book.pages) {
    throw new AppError('Nincs ilyen oldal.', 404);
  }
  // The same until the file is replaced - and then the book is read again.
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(await pageImagePath(book, page));
};

// GET /library/books/:id/pages/:page/opening - the page's first words: what
// a new line of the contents pointing here is offered as.
export const getLibraryPageOpening = async (req, res) => {
  const book = await bookOf(req);
  const page = Number(req.params.page);
  if (!Number.isInteger(page) || page < 1 || page > book.pages) {
    throw new AppError('Nincs ilyen oldal.', 404);
  }
  res.status(200).json({
    status: 'success',
    data: { opening: await pageOpening(book, page) },
  });
};

// GET /library/books/:id/toc-proposal - a table of contents guessed from
// the book (the largest text of each page). Nothing is saved: the owner
// corrects it and sends it with PATCH.
export const getLibraryTocProposal = async (req, res) => {
  const book = await bookOf(req);
  res.status(200).json({ status: 'success', data: { toc: await proposeToc(book) } });
};

// POST /library/shelves/:shelf/books - a PDF put on a shelf from the app
// (.single('file')): written straight into the shelf's folder under its own
// name, then read like any file found there. A book can be large, so it
// goes to the disk as it arrives, never through memory.
const MAX_BOOK_BYTES = 300 * 1024 * 1024;

export const uploadLibraryBook = (req, res, next) => {
  const shelf = req.params.shelf;
  if (!shelfFolders().includes(shelf)) return next(new AppError('Nincs ilyen polc.', 404));
  let refused = null;
  const upload = multer({
    storage: multer.diskStorage({
      destination: (r, file, cb) => cb(null, path.dirname(uploadTarget(shelf, 'x'))),
      // Under a name of its own until it is whole.
      filename: (r, file, cb) => cb(null, `.feltoltes-${Date.now()}.tmp`),
    }),
    limits: { fileSize: MAX_BOOK_BYTES, files: 1 },
    fileFilter: (r, file, cb) => {
      // Browsers send the name as latin1 bytes - it is UTF-8.
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const target = uploadTarget(shelf, file.originalname);
      if (!/\.pdf$/i.test(file.originalname) || !target) {
        refused = new AppError('Csak PDF tölthető fel.', 400);
      } else if (fs.existsSync(target)) {
        refused = new AppError('Ezen a polcon már van ilyen nevű könyv.', 409);
      }
      cb(null, !refused);
    },
  }).single('file');

  upload(req, res, (err) => {
    const temp = req.file?.path;
    const drop = () => temp && fs.rm(temp, { force: true }, () => {});
    if (err) {
      drop();
      return next(
        err.code === 'LIMIT_FILE_SIZE'
          ? new AppError('A könyv legfeljebb 300 MB lehet.', 400)
          : err,
      );
    }
    if (refused) return next(refused);
    if (!req.file) return next(new AppError('Nincs fájl a kérésben.', 400));
    // A PDF by its first bytes too, not just its name.
    const head = Buffer.alloc(5);
    const fd = fs.openSync(temp, 'r');
    fs.readSync(fd, head, 0, 5, 0);
    fs.closeSync(fd);
    if (head.toString('latin1') !== '%PDF-') {
      drop();
      return next(new AppError('Ez nem PDF fájl.', 400));
    }
    fs.renameSync(temp, uploadTarget(shelf, req.file.originalname));
    startScan();
    res.status(202).json({ status: 'success', data: { scan: scanState() } });
  });
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text around the first word found, cut at word ends, in three parts
// so the page can mark the match.
function snippetOf(page, words) {
  const at = page.folded.indexOf(words[0]);
  // The two texts line up letter by letter (fold only swaps a letter for
  // its plain one) - if they once don't, the start of the page will do.
  if (at < 0 || page.text.length !== page.folded.length) {
    return { before: '', match: '', after: page.text.slice(0, 160) };
  }
  const end = at + words[0].length;
  let from = Math.max(0, at - 60);
  let to = Math.min(page.text.length, end + 100);
  if (from > 0) from = page.text.indexOf(' ', from) + 1 || from;
  if (to < page.text.length)
    to = page.text.lastIndexOf(' ', to) > end ? page.text.lastIndexOf(' ', to) : to;
  return {
    before: (from > 0 ? '… ' : '') + page.text.slice(from, at),
    match: page.text.slice(at, end),
    after: page.text.slice(end, to) + (to < page.text.length ? ' …' : ''),
  };
}

// GET /library/search?q=...&shelf=... - books by title, subtitle and
// author, lines of the
// tables of contents, and pages by their text: every word asked for must
// be there, accents and capitals don't matter.
export const searchLibrary = async (req, res) => {
  const words = fold(req.query.q).split(' ').filter(Boolean).slice(0, 8);
  if (!words.length || words.join('').length < 2) {
    throw new AppError('Legalább két betűt írj be.', 400);
  }
  const filter =
    typeof req.query.shelf === 'string' && req.query.shelf ? { shelf: req.query.shelf } : {};
  const books = await LibraryBook.find(filter).lean();
  const byId = new Map(books.map((b) => [String(b._id), b]));
  const has = (text) => {
    const folded = fold(text);
    return words.every((w) => folded.includes(w));
  };

  const titles = books
    .filter((b) => has(`${b.title} ${b.subtitle ?? ''} ${b.author ?? ''}`))
    .sort((a, b) => a.title.localeCompare(b.title, 'hu'))
    .map(bookCard);

  const contents = books
    .flatMap((b) =>
      b.toc
        .filter((e) => has(e.title))
        .map((e) => ({ book: String(b._id), page: e.page, title: e.title })),
    )
    .slice(0, MAX_HITS);

  const found = await LibraryPage.find({
    book: { $in: books.map((b) => b._id) },
    $and: words.map((w) => ({ folded: { $regex: escapeRegex(w) } })),
  })
    .sort({ book: 1, page: 1 })
    .limit(MAX_HITS + 1)
    .lean();

  const pages = found.slice(0, MAX_HITS).map((p) => ({
    book: String(p.book),
    page: p.page,
    snippet: snippetOf(p, words),
  }));

  const mentioned = new Set([...contents, ...pages].map((h) => h.book));
  res.status(200).json({
    status: 'success',
    data: {
      titles,
      contents,
      pages,
      // More pages matched than are sent.
      more: found.length > MAX_HITS,
      // The books the hits are in, by id.
      books: Object.fromEntries([...mentioned].map((id) => [id, bookCard(byId.get(id))])),
    },
  });
};
