// Puts a folder of PDF books on a Könyvtár shelf, sending the scanned ones
// through Stirling PDF's OCR first - one book at a time, so the NAS is
// never asked for more than one job:
//
//   node scripts/ocrFolder.mjs <folder> <shelf> [--lang hun+eng] [--pause 30] [--dry]
//
// e.g.  node scripts/ocrFolder.mjs D:\kottak\gitar gitar --lang eng
//
// For every PDF in <folder> (not its subfolders):
//  - one that already has text is copied to the shelf as it is;
//  - a scan goes to Stirling (the direct address - a proxy in front of it
//    gives up before a long OCR is over), and what comes back, the same
//    pages with the text written into them, is saved on the shelf.
// The originals are never touched. A book already on the shelf (the same
// file name) is skipped, so a run that stopped can simply be started again.
// Afterwards: "Frissítés" on the Könyvtár page.
//
// In the server's .env (never in git):
//   STIRLING_URL=http://<the NAS's address>:7890
//   STIRLING_API_KEY=<from Stirling: Account Settings → API key>
//
// --lang:  the books' language(s) for the OCR, as Stirling names them
//          (hun, eng, deu...), joined with + ; hun+eng by default.
// --pause: seconds to wait between two OCR jobs (30) - lets the NAS breathe.
// --dry:   only says what it would do with each book.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { LIBRARY_DIR } from '../src/utils/dataDirs.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args.splice(at, 2)[1];
};
const languages = option('lang', 'hun+eng').split('+').filter(Boolean);
const pauseSeconds = Number(option('pause', '30'));
const dry = args.includes('--dry');
const [folder, shelf] = args.filter((a) => a !== '--dry');

const stirlingUrl = process.env.STIRLING_URL?.replace(/\/+$/, '');
const apiKey = process.env.STIRLING_API_KEY;

if (!folder || !shelf) {
  console.error(
    'Usage: node scripts/ocrFolder.mjs <folder> <shelf> [--lang hun+eng] [--pause 30] [--dry]',
  );
  process.exit(1);
}
const shelfDir = path.join(LIBRARY_DIR, shelf);
if (!fs.existsSync(shelfDir)) {
  console.error(`No such shelf: ${shelfDir} (a shelf is a folder there - create it first)`);
  process.exit(1);
}

// A scan has no text of its own: a few pages spread over the book are
// looked at, and a book is taken for a scan when hardly any has words.
async function hasText(file) {
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 });
  const doc = await task.promise;
  try {
    const picks = [...new Set([0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.ceil(doc.numPages * f)))];
    let withText = 0;
    for (const n of picks) {
      const content = await (await doc.getPage(n)).getTextContent();
      if (
        content.items
          .map((i) => i.str)
          .join('')
          .trim().length > 20
      )
        withText += 1;
    }
    return { pages: doc.numPages, text: withText * 2 > picks.length };
  } finally {
    await task.destroy();
  }
}

// One book through Stirling's OCR; resolves once the result is on the disk.
async function ocr(file, target) {
  const form = new FormData();
  form.append('fileInput', new Blob([fs.readFileSync(file)]), path.basename(file));
  for (const language of languages) form.append('languages', language);
  form.append('ocrType', 'skip-text');
  form.append('ocrRenderType', 'hocr');
  for (const off of ['sidecar', 'deskew', 'clean', 'cleanFinal', 'removeImagesAfter']) {
    form.append(off, 'false');
  }
  const res = await fetch(`${stirlingUrl}/api/v1/misc/ocr-pdf`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey },
    body: form,
    // A long book on a slow NAS: an hour at most.
    signal: AbortSignal.timeout(60 * 60 * 1000),
  });
  if (!res.ok) {
    throw new Error(`Stirling answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`Stirling did not send a PDF: ${pdf.subarray(0, 200).toString('utf8')}`);
  }
  // Under another name until it is whole - a half-written book is never
  // found on the shelf.
  const temp = `${target}.part`;
  fs.writeFileSync(temp, pdf);
  fs.renameSync(temp, target);
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const megabytes = (file) => `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`;

const books = fs
  .readdirSync(folder, { withFileTypes: true })
  .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b, 'hu'));

console.log(`${books.length} PDF in ${folder} -> ${shelfDir}${dry ? ' (dry run)' : ''}`);
const counts = { copied: 0, ocr: 0, skipped: 0, failed: 0 };
let ocrJobs = 0;

for (const [index, name] of books.entries()) {
  const file = path.join(folder, name);
  const target = path.join(shelfDir, name);
  const label = `[${index + 1}/${books.length}] ${name} (${megabytes(file)})`;
  if (fs.existsSync(target)) {
    console.log(`${label}: already on the shelf - skipped`);
    counts.skipped += 1;
    continue;
  }
  try {
    const { pages, text } = await hasText(file);
    if (text) {
      console.log(`${label}: ${pages} pages, has text - copied as it is`);
      if (!dry) fs.copyFileSync(file, target);
      counts.copied += 1;
      continue;
    }
    if (dry) {
      console.log(`${label}: ${pages} pages, a scan - would go to OCR (${languages.join('+')})`);
      counts.ocr += 1;
      continue;
    }
    if (!stirlingUrl || !apiKey) {
      throw new Error('a scan, but STIRLING_URL / STIRLING_API_KEY are not set in .env');
    }
    if (ocrJobs > 0 && pauseSeconds > 0) await sleep(pauseSeconds);
    ocrJobs += 1;
    const start = Date.now();
    process.stdout.write(`${label}: ${pages} pages, a scan - OCR (${languages.join('+')})... `);
    await ocr(file, target);
    const seconds = Math.round((Date.now() - start) / 1000);
    console.log(`done in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    counts.ocr += 1;
  } catch (err) {
    console.log(`\n${label}: FAILED - ${err.message}`);
    counts.failed += 1;
  }
}

console.log(
  `\nCopied: ${counts.copied}, OCR: ${counts.ocr}, already there: ${counts.skipped}, failed: ${counts.failed}.`,
);
if (!dry && counts.copied + counts.ocr > 0) {
  console.log('Now press "Frissítés" on the Könyvtár page.');
}
process.exit(counts.failed ? 1 : 0);
