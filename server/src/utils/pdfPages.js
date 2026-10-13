import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

// Reading PDFs with pdf.js: opening one, and drawing a page of it (on
// @napi-rs/canvas, which pdf.js picks up itself in Node). Both are external
// to the bundle and shipped by sync.js, like sharp - loaded only here, on
// demand. Used by the documents' previews (documentPreviews.js) and the
// Könyvtár (libraryIndex.js).

// Opens a PDF - file: a path, or the PDF itself (a Buffer). The caller
// closes it: `await task.destroy()`.
//
// partial (a path only): the file is not read into memory - pdf.js fetches
// just the parts it needs for what is asked of it (a tenth of a 35 MB
// scanned book for one page). For drawing a page or two of a big PDF; to
// read all of it, the whole file at once is quicker.
export async function openPdf(file, { partial = false } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Fonts a PDF names but doesn't embed (Helvetica, Times...) come from
  // pdf.js's own folder.
  const pdfjsDir = path.dirname(
    createRequire(path.join(process.cwd(), 'noop.js')).resolve('pdfjs-dist/package.json'),
  );
  // (Folders as pdf.js wants them: "/" separators, ending in "/".)
  const folder = (name) => `${path.join(pdfjsDir, name).split(path.sep).join('/')}/`;
  const source =
    partial && !Buffer.isBuffer(file)
      ? {
          url: pathToFileURL(path.resolve(file)).href,
          disableAutoFetch: true,
          disableStream: true,
          rangeChunkSize: 262144,
        }
      : { data: new Uint8Array(Buffer.isBuffer(file) ? file : fs.readFileSync(file)) };
  const task = pdfjs.getDocument({
    ...source,
    standardFontDataUrl: folder('standard_fonts'),
    wasmUrl: folder('wasm'),
    verbosity: 0,
  });
  return { task, doc: await task.promise };
}

// One page as a PNG, `width` pixels wide.
export async function renderPdfPage(doc, pageNumber, width) {
  const page = await doc.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / unscaled.width });
  const { canvas, context } = doc.canvasFactory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  // PDF pages are white paper - transparent where nothing's drawn.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toBuffer('image/png');
}
