// Sample beszámoló PDF with a hike under its day - the map and the numbers
// - to look at the layout. The map: a JPEG made by trackMapSample.mjs.
// Run from server/: node scripts/reportHikeSample.mjs <map.jpg> [out.pdf]
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { renderReport } from '../src/controllers/tourReportController.js';
import { trackStats } from '../src/utils/documentTracks.js';

const [map, out = 'report-hike-sample.pdf'] = process.argv.slice(2);
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 78, bottom: 70, left: 60, right: 60 },
  bufferPages: true,
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
await renderReport(doc, {
  tour: { order: 32, title: 'Mátrai nyár' },
  facts: { place: 'Mátraháza', dates: '2026. július 10–12.', headcount: '42 fő' },
  days: [
    { ops: [{ insert: 'Megérkezés, szobafoglalás, közös vacsora.\n' }] },
    { ops: [{ insert: 'Túra a Kékesre, este tábortűz.\n' }] },
    null,
  ],
  dayLabels: ['július 10., péntek', 'július 11., szombat', 'július 12., vasárnap'],
  hikes: [
    {
      name: 'Kékes körtúra',
      day: 1,
      map: map ?? null,
      stats: trackStats({
        distanceM: 12336,
        elevationGainM: 540,
        elevationLossM: 525,
        startedAt: new Date('2026-07-11T07:12:00Z'),
        durationSec: 17556,
      }),
    },
    {
      name: 'Reggeli séta (térkép nélkül)',
      day: 2,
      map: null,
      stats: trackStats({ distanceM: 3210, elevationGainM: null, elevationLossM: null }),
    },
  ],
  photo: null,
  mapUrl: 'https://www.google.com/maps?q=47.87,19.98',
  panoramaQr: null,
  presidentName: 'Minta Elnök',
  signedAt: new Date(),
  draft: false,
});
stream.on('finish', () => {
  console.log('written', out);
  process.exit(0);
});
