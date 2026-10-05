// Sample beszámoló PDF with the 360° panorama QR card - to look at the layout.
// Run from server/: node scripts/reportPanoramaSample.mjs [out.pdf]
import fs from 'fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { renderReport } from '../src/controllers/tourReportController.js';

const out = process.argv[2] ?? 'report-panorama-sample.pdf';
const panoramaUrl = 'https://example.com/panorama/tatrai-osz';
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 78, bottom: 70, left: 60, right: 60 },
  bufferPages: true,
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
await renderReport(doc, {
  tour: { order: 32, title: 'Tátrai ősz', panoramaUrl, panoramaTitle: 'Poprádi-tó' },
  facts: { place: 'Tátralomnic, Szlovákia', dates: '2026. október 22–25.', headcount: '42 fő' },
  days: [
    { ops: [{ insert: 'Megérkezés, szobafoglalás, közös vacsora.\n' }] },
    { ops: [{ insert: 'Túra a Zöld-tóhoz, este tábortűz.\n' }] },
  ],
  dayLabels: ['2026. október 22., csütörtök', '2026. október 23., péntek'],
  photo: null,
  mapUrl: 'https://www.google.com/maps?q=49.16,20.28',
  panoramaQr: await QRCode.toBuffer(panoramaUrl, { width: 400, margin: 0 }),
  presidentName: 'Minta Elnök',
  signedAt: new Date(),
  draft: false,
});
stream.on('finish', () => {
  console.log('written', out);
  process.exit(0);
});
