// Renders a PDF's page (the first, unless told which) to a PNG, to look at it:
//   node scripts/pdfToPng.mjs <in.pdf> <out.png> [page]
// (pdfjs-dist and @napi-rs/canvas are already here for the documents'
// previews - see utils/documentPreviews.js.)
import fs from 'fs';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input, output, pageNumber = '1'] = process.argv.slice(2);
const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(input)) }).promise;
const page = await pdf.getPage(Number(pageNumber));
const viewport = page.getViewport({ scale: 1.5 });
const canvas = createCanvas(viewport.width, viewport.height);
await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
fs.writeFileSync(output, canvas.toBuffer('image/png'));
