import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])) }).promise;
console.log('pages', pdf.numPages);
for (let p = pdf.numPages; p >= 1; p -= 1) {
  const text = (await (await pdf.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ');
  if (text.includes('Dalok előadók szerint') && p > 10) console.log('index title on page', p);
}
