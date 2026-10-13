import fs from 'fs';
import path from 'path';
import { LIBRARY_DIR } from './dataDirs.js';
import { openPdf, renderPdfPage } from './pdfPages.js';
import { loadSharp } from '../photos/imageFiles.js';
import { LibraryBook, LibraryPage } from '../models/libraryModels.js';
import logger from '../logger.js';

// Média → Könyvtár: the books are the PDFs in the library folder, each
// subfolder a shelf - put a file there (or take one away) and "Frissítés"
// makes the page follow. A folder starting with "_" is not a shelf (the
// pages' pictures are kept in one).
//
// A book's text is read page by page and stored (libraryModels.js). A
// scanned book has none until it went through OCR - that is done outside
// the app (Stirling PDF's OCR writes the text into the PDF itself).

// The pictures of the pages asked for so far: _lapok/<book id>/<page>.webp.
const PAGES_DIR = path.join(LIBRARY_DIR, '_lapok');
const PAGE_WIDTH = 1400;

// The shelves with a name of their own; any other folder is shown by its
// folder name.
const SHELF_TITLES = { gitar: 'Gitár', harmonika: 'Harmonika' };

export const shelfTitle = (folder) =>
  SHELF_TITLES[folder] ?? folder.charAt(0).toLocaleUpperCase('hu') + folder.slice(1);

// Without accents, in lower case, white space collapsed - how both the
// stored text and what is searched for are compared ("Törted" = "torted").
export const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const collapse = (text) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

// "daily_studies.pdf" -> "daily studies"
const titleFromFilename = (filename) =>
  path.parse(filename).name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || filename;

export function shelfFolders() {
  try {
    return fs
      .readdirSync(LIBRARY_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => shelfTitle(a).localeCompare(shelfTitle(b), 'hu'));
  } catch {
    return [];
  }
}

function pdfFiles(shelf) {
  try {
    return fs
      .readdirSync(path.join(LIBRARY_DIR, shelf), { withFileTypes: true })
      .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export const bookFilePath = (book) => path.join(LIBRARY_DIR, book.shelf, book.filename);

// The PDF's bookmarks as a flat list, each with the page it points at.
async function readBookmarks(doc) {
  const toc = [];
  const walk = async (items, level) => {
    for (const item of items ?? []) {
      try {
        const dest =
          typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        const title = collapse(item.title ?? '');
        if (title && Array.isArray(dest) && dest[0]) {
          const page = (await doc.getPageIndex(dest[0])) + 1;
          toc.push({ title: title.slice(0, 200), page, level: Math.min(level, 3) });
        }
      } catch {
        // A bookmark pointing nowhere is left out.
      }
      await walk(item.items, level + 1);
    }
  };
  await walk(await doc.getOutline(), 0);
  return toc;
}

// Reads one PDF: its pages' text and its bookmarks.
async function readBook(file) {
  const { task, doc } = await openPdf(file);
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = collapse(content.items.map((item) => item.str ?? '').join(' '));
      pages.push({ page: n, text, folded: fold(text) });
      page.cleanup();
    }
    return { pages, toc: await readBookmarks(doc) };
  } finally {
    await task.destroy();
  }
}

// A table of contents guessed for a book without bookmarks: on each page
// the text written clearly larger than the rest - a chapter's or a song's
// title. Works on a PDF with real text; in a scan the letters' sizes are
// what the OCR made of them, so little of it is right. Only a proposal: the
// owner corrects it before it is saved.
export async function proposeToc(book) {
  const { task, doc } = await openPdf(bookFilePath(book));
  try {
    const toc = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const items = (await page.getTextContent()).items.filter((i) => i.str?.trim());
      page.cleanup();
      if (!items.length) continue;
      const heights = items.map((i) => i.height).sort((a, b) => a - b);
      const median = heights[Math.floor(heights.length / 2)];
      const max = heights[heights.length - 1];
      if (max < median * 1.3) continue;
      const title = collapse(
        items
          .filter((i) => i.height >= max * 0.85)
          .map((i) => i.str)
          .join(' '),
      ).slice(0, 120);
      // Something to read, and not the line the page before had (a
      // running head).
      if ((title.match(/\p{L}/gu) ?? []).length < 3) continue;
      if (toc.length && fold(toc[toc.length - 1].title) === fold(title)) continue;
      toc.push({ title, page: n, level: 0 });
    }
    return toc;
  } finally {
    await task.destroy();
  }
}

// A page's first words - what a new line of the contents is offered as.
export async function pageOpening(book, pageNumber) {
  const page = await LibraryPage.findOne({ book: book._id, page: pageNumber }).lean();
  return (page?.text ?? '').split(' ').slice(0, 6).join(' ').slice(0, 80);
}

// Where an uploaded PDF goes on a shelf: its own name, made safe for a
// file name (accents kept); null when nothing usable is left of it.
export function uploadTarget(shelf, originalName) {
  const base = path
    .parse(String(originalName ?? ''))
    .name.normalize('NFC')
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return base ? path.join(LIBRARY_DIR, shelf, `${base}.pdf`) : null;
}

function deletePageImages(bookId) {
  fs.rmSync(path.join(PAGES_DIR, String(bookId)), { recursive: true, force: true });
}

// A page's picture - drawn the first time it is asked for, then kept.
export async function pageImagePath(book, pageNumber) {
  const file = path.join(PAGES_DIR, String(book._id), `${pageNumber}.webp`);
  if (fs.existsSync(file)) return file;
  const sharp = await loadSharp();
  // Only the parts of the PDF this page needs are read from the disk.
  const { task, doc } = await openPdf(bookFilePath(book), { partial: true });
  try {
    const png = await renderPdfPage(doc, pageNumber, PAGE_WIDTH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp(png).webp({ quality: 80 }).toFile(file);
  } finally {
    await task.destroy();
  }
  return file;
}

// --- "Frissítés": the folders read again, one scan at a time ---

// How the running (or the last) scan stands - told with the shelves, so
// the page can show it.
const scan = { running: false, done: 0, total: 0, current: null, errors: [] };

export const scanState = () => ({ ...scan, errors: [...scan.errors] });

async function indexBook(shelf, filename, stat, existing) {
  const { pages, toc } = await readBook(path.join(LIBRARY_DIR, shelf, filename));
  const facts = {
    pages: pages.length,
    hasText: pages.some((p) => p.text.length > 20),
    size: stat.size,
    modifiedAt: Math.round(stat.mtimeMs),
  };
  let book = existing;
  if (book) {
    // A replaced file: the owner's own title and contents stay.
    if (!book.tocEdited) book.toc = toc;
    Object.assign(book, facts);
    await book.save();
    deletePageImages(book._id);
  } else {
    book = await LibraryBook.create({
      shelf,
      filename,
      title: titleFromFilename(filename),
      toc,
      ...facts,
    });
  }
  await LibraryPage.deleteMany({ book: book._id });
  await LibraryPage.insertMany(pages.map((p) => ({ ...p, book: book._id })));
}

async function runScan() {
  const books = await LibraryBook.find();
  const known = new Map(books.map((b) => [`${b.shelf}/${b.filename}`, b]));
  const todo = [];
  for (const shelf of shelfFolders()) {
    for (const filename of pdfFiles(shelf)) {
      const key = `${shelf}/${filename}`;
      const existing = known.get(key);
      known.delete(key);
      const stat = fs.statSync(path.join(LIBRARY_DIR, shelf, filename));
      if (
        !existing ||
        existing.size !== stat.size ||
        existing.modifiedAt !== Math.round(stat.mtimeMs)
      ) {
        todo.push({ shelf, filename, stat, existing });
      }
    }
  }
  // What is left has no file any more.
  for (const gone of known.values()) {
    await LibraryPage.deleteMany({ book: gone._id });
    await LibraryBook.deleteOne({ _id: gone._id });
    deletePageImages(gone._id);
  }
  scan.done = 0;
  scan.total = todo.length;
  for (const item of todo) {
    scan.current = `${item.shelf}/${item.filename}`;
    try {
      await indexBook(item.shelf, item.filename, item.stat, item.existing);
    } catch (err) {
      scan.errors.push(`${scan.current}: ${err.message}`);
      logger.error(`library: ${scan.current} could not be read: ${err.message}`);
    }
    scan.done += 1;
  }
}

// Starts a scan in the background (false: one is already running).
// scanFinished is for the tests - the request itself doesn't wait.
let scanPromise = Promise.resolve();
export const scanFinished = () => scanPromise;

// Asked for while one runs (a book uploaded meanwhile): the folders are
// looked through once more when it is over.
let scanAgain = false;

export function startScan() {
  if (scan.running) {
    scanAgain = true;
    return false;
  }
  Object.assign(scan, { running: true, done: 0, total: 0, current: null, errors: [] });
  const round = async () => {
    do {
      scanAgain = false;
      await runScan();
    } while (scanAgain);
  };
  scanPromise = round()
    .catch((err) => {
      scan.errors.push(err.message);
      logger.error(`library: scan failed: ${err.message}`);
    })
    .finally(() => {
      scan.running = false;
      scan.current = null;
    });
  return true;
}
