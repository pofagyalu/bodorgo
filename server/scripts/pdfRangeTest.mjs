// Compares opening a PDF whole (read into memory) with letting pdf.js read
// only the parts it needs from the file, for drawing one page:
//   node scripts/pdfRangeTest.mjs <in.pdf> [page]
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input, pageNumber = '40'] = process.argv.slice(2);

// Counts what is read from disk through streams (how pdf.js reads ranges).
let streamed = 0;
const realCreate = fs.createReadStream;
fs.createReadStream = (...args) => {
  const stream = realCreate(...args);
  stream.on('data', (chunk) => (streamed += chunk.length));
  return stream;
};

async function draw(label, source) {
  const before = process.memoryUsage().rss;
  const start = performance.now();
  const task = getDocument({ ...source, verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(Number(pageNumber));
  const viewport = page.getViewport({ scale: 1400 / page.getViewport({ scale: 1 }).width });
  const { canvas, context } = doc.canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  const size = canvas.toBuffer('image/png').length;
  console.log(
    `${label}: ${Math.round(performance.now() - start)} ms, +${Math.round((process.memoryUsage().rss - before) / 1e6)} MB, png ${size} bytes`,
  );
  console.log(`  read through streams: ${streamed} of ${fs.statSync(input).size} bytes`);
  streamed = 0;
  await task.destroy();
}

await draw('whole file', { data: new Uint8Array(fs.readFileSync(input)) });
await draw('by ranges ', {
  url: pathToFileURL(path.resolve(input)).href,
  disableAutoFetch: true,
  disableStream: true,
  rangeChunkSize: 262144,
});
