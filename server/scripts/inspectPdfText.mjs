// Shows what a PDF holds for the Könyvtár's search: the page count, the
// bookmarks (table of contents), how much text each page has, and a sample:
//   node scripts/inspectPdfText.mjs <in.pdf> [samplePage]
import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input, samplePage] = process.argv.slice(2);
const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(input)) }).promise;
console.log(`${input}: ${pdf.numPages} pages`);

const outline = await pdf.getOutline();
const printOutline = (items, depth = 0) => {
  for (const item of items) {
    console.log(`${'  '.repeat(depth)}- ${item.title}`);
    printOutline(item.items || [], depth + 1);
  }
};
if (outline?.length) {
  console.log(`Bookmarks (${outline.length} top level):`);
  printOutline(outline);
} else {
  console.log('No bookmarks.');
}

const counts = [];
const texts = [];
for (let n = 1; n <= pdf.numPages; n++) {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  const text = content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('');
  counts.push(text.trim().length);
  texts.push(text);
}
const withText = counts.filter((c) => c > 20).length;
console.log(`Pages with text: ${withText} of ${pdf.numPages}`);
console.log(`Characters per page: ${counts.join(' ')}`);

const sample = samplePage ? Number(samplePage) : counts.findIndex((c) => c > 200) + 1;
if (sample > 0) {
  console.log(`\n--- page ${sample} ---\n${texts[sample - 1].slice(0, 1500)}`);
}
