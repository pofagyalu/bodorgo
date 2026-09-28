import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import Document from '../models/documentModel.js';
import { CLUB_DOCUMENTS_DIR } from './dataDirs.js';
import { loadSharp } from '../photos/imageFiles.js';
import logger from '../logger.js';

// A club document's card on Dokumentumok shows a small picture of it (a
// tour's Extrák have none): a
// PDF's first page, or the photo/scan itself - one WebP per document in
// documents/previews/ (not copied to the live server by sync.js - each
// server makes its own). Made at upload, and at startup for any document
// still without one.

const PREVIEW_WIDTH = 360;

export const DOCUMENT_PREVIEWS_DIR = path.join(CLUB_DOCUMENTS_DIR, 'previews');

export const previewPath = (filename) =>
  path.join(DOCUMENT_PREVIEWS_DIR, `${path.parse(filename).name}.webp`);

// pdf.js draws the page (on @napi-rs/canvas, which it picks up itself in
// Node); both are external to the bundle and shipped by sync.js, like
// sharp. Loaded only here, on demand.
async function renderPdfFirstPage(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Fonts a PDF names but doesn't embed (Helvetica, Times...) come from
  // pdf.js's own folder.
  const pdfjsDir = path.dirname(
    createRequire(path.join(process.cwd(), 'noop.js')).resolve('pdfjs-dist/package.json'),
  );
  // (Folders as pdf.js wants them: "/" separators, ending in "/".)
  const folder = (name) => `${path.join(pdfjsDir, name).split(path.sep).join('/')}/`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    standardFontDataUrl: folder('standard_fonts'),
    wasmUrl: folder('wasm'),
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    // Drawn at twice the preview's width, so the shrink below is sharp.
    const viewport = page.getViewport({ scale: (PREVIEW_WIDTH * 2) / unscaled.width });
    const { canvas, context } = doc.canvasFactory.create(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    // PDF pages are white paper - transparent where nothing's drawn.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await task.destroy();
  }
}

// Makes (or remakes) one document's preview; true when it worked.
export async function makeDocumentPreview(filename) {
  const src = path.join(CLUB_DOCUMENTS_DIR, filename);
  const sharp = await loadSharp();
  const input = /\.pdf$/i.test(filename) ? await renderPdfFirstPage(src) : src;
  fs.mkdirSync(DOCUMENT_PREVIEWS_DIR, { recursive: true });
  await sharp(input)
    .rotate()
    .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(previewPath(filename));
  return true;
}

// The same, never throwing - a document without a preview just shows its
// icon (and the next startup tries again).
export async function tryMakeDocumentPreview(document) {
  try {
    await makeDocumentPreview(document.filename);
    if (!document.preview) {
      await Document.updateOne({ _id: document._id }, { preview: true });
      document.preview = true;
    }
  } catch (err) {
    logger.error(`documents: no preview for ${document.filename}: ${err.message}`);
  }
}

export function deleteDocumentPreview(filename) {
  fs.rm(previewPath(filename), { force: true }, () => {});
}

// At startup, in the background: every document still without a preview
// (uploaded before previews existed, or one that failed) gets one.
export async function ensureDocumentPreviews() {
  const missing = await Document.find({ preview: { $ne: true }, tour: null });
  for (const document of missing) {
    if (fs.existsSync(path.join(CLUB_DOCUMENTS_DIR, document.filename))) {
      await tryMakeDocumentPreview(document);
    }
  }
  if (missing.length) logger.info(`documents: previews checked for ${missing.length} document(s)`);
}
