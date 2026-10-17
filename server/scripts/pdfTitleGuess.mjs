// Guesses a table of contents for a PDF without bookmarks: on each page,
// the text written largest (when clearly larger than the rest):
//   node scripts/pdfTitleGuess.mjs <in.pdf>
import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(input)), verbosity: 0 })
  .promise;
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const items = (await page.getTextContent()).items.filter((i) => i.str?.trim());
  if (!items.length) continue;
  const heights = items.map((i) => i.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const max = heights[heights.length - 1];
  const big = items.filter((i) => i.height >= max * 0.85);
  const title = big
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  console.log(
    `${String(n).padStart(3)}  ${max.toFixed(1)}/${median.toFixed(1)}  ${max >= median * 1.3 ? '*' : ' '} ${title.slice(0, 90)}`,
  );
}
