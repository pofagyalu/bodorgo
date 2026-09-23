// Verifies downloadAttendeesExcel (see controllers/tourExcelController.js)
// produces a real, valid .xlsx with the right numbers - generates one
// against a throwaway tour/family, then reads it back with exceljs
// itself to check actual cell values (not just "did it not crash").
//
// Creates its own throwaway tour + reservations (order 9979) - never
// touches real data. Safe to re-run.
//
// Usage:
//   node scripts/testDownloadAttendeesExcel.js

import 'dotenv/config';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import { downloadAttendeesExcel } from '../src/controllers/tourExcelController.js';

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures++;
}

const TEST_ORDER = 9979;

await mongoose.connect(config.db.testUri);

const leftover = await Tour.findOne({ order: TEST_ORDER });
if (leftover) {
  await Reservation.deleteMany({ tour: leftover._id });
  await Tour.deleteOne({ _id: leftover._id });
}

const familyId = new mongoose.Types.ObjectId();
const zoltanId = new mongoose.Types.ObjectId();
const ilonaId = new mongoose.Types.ObjectId();
const soloId = new mongoose.Types.ObjectId();

await User.create([
  { _id: zoltanId, sub: `test-${zoltanId}`, name: 'Nagy Zoltán', role: 'member', familyId },
  { _id: ilonaId, sub: `test-${ilonaId}`, name: 'Nagy Ilona', role: 'member', familyId },
  { _id: soloId, sub: `test-${soloId}`, name: 'Kis Anna', role: 'member' },
]);

const tour = await Tour.create({
  order: TEST_ORDER,
  title: 'ZZ Test Tour (Excel export)',
  location: { description: 'Teszt', address: 'Teszt utca 1.', coordinates: [19, 47] },
  startDate: new Date('2030-06-01'),
  duration: 3,
  maxCapacity: 10,
  summary: 'Teszt',
  description: 'Teszt tábor az Excel export teszteléséhez.',
  imageCover: `tour-${TEST_ORDER}-cover.jpg`,
  accommodationPricePerNight: 1000,
  advancePaymentPercentage: 20,
  // Matches the real reported case: "Reggeli felnőtt" picked on two
  // separate days should show as two separate columns (day 1 AND day 2),
  // never merged into one - Zoltán joins both, Ilona and Anna join
  // neither.
  schedule: [
    {
      day: 1,
      time: '08:00',
      description: 'Reggeli felnőtt',
      isOptional: true,
      extraCost: 2600,
      participants: [{ user: zoltanId, name: 'Nagy Zoltán' }],
    },
    {
      day: 2,
      time: '08:00',
      description: 'Reggeli felnőtt',
      isOptional: true,
      extraCost: 2600,
      participants: [{ user: zoltanId, name: 'Nagy Zoltán' }],
    },
    {
      day: 1,
      time: '09:00',
      description: 'Szabadidő',
      // Not optional - a plain schedule item, must never get its own column.
    },
  ],
});

const familyReservation = await Reservation.create({
  tour: tour._id,
  bookedBy: zoltanId,
  attendees: [
    { user: zoltanId, name: 'Nagy Zoltán', nights: 2, paid: true },
    { user: ilonaId, name: 'Nagy Ilona', nights: 2, paid: false },
  ],
});
const soloReservation = await Reservation.create({
  tour: tour._id,
  bookedBy: soloId,
  attendees: [{ user: soloId, name: 'Kis Anna', nights: 2, paid: false }],
});

function fakeRes() {
  const chunks = [];
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    write(chunk) {
      chunks.push(chunk);
    },
    end(chunk) {
      if (chunk) chunks.push(chunk);
    },
    getBuffer() {
      return Buffer.concat(chunks);
    },
  };
}

try {
  const req = { params: { id: String(tour._id) } };
  const res = fakeRes();
  await downloadAttendeesExcel(req, res);

  check('sets the correct .xlsx content type', res.headers['Content-Type'] === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  check('sets a filename in the Content-Disposition header', res.headers['Content-Disposition'].includes('.xlsx'));

  const buffer = res.getBuffer();
  check('produced a substantial file, not an empty/broken stub', buffer.length > 1000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Résztvevők');
  check('the worksheet exists and is named as expected', !!sheet);

  check('row 1 has the tour title', sheet.getCell('A1').value === 'ZZ Test Tour (Excel export)');

  // Row 4 is the column header row (1: title, 2: dates, 3: generated-at, 4: headers)
  const headerValues = sheet.getRow(4).values.filter(Boolean);
  check(
    'header row lists accommodation columns (no "paid" column) plus one column PER optional event occurrence, not merged by name',
    headerValues.join('|') === 'Név|Család|Éjszakák|Teljes ár|Előleg|Fizetendő|Reggeli felnőtt (1. nap)|Reggeli felnőtt (2. nap)',
  );

  // Find each attendee's own row and the family subtotal row by scanning column A.
  const rowsByName = new Map();
  sheet.eachRow((row) => {
    rowsByName.set(row.getCell(1).value, row);
  });

  // House fee 2000 (1000/night * 2 nights) split across all 3 attendees'
  // 6 total person-nights -> 333.33/person-night, ceiled per attendee:
  // 667 total, 134 advance (20%), 533 rest.
  check('Nagy Zoltán has his own row with the right total/advance/rest (667/134/533)', (() => {
    const r = rowsByName.get('Nagy Zoltán');
    return r && r.getCell(4).value === 667 && r.getCell(5).value === 134 && r.getCell(6).value === 533;
  })());
  check('the solo attendee (Kis Anna) has no family label', rowsByName.get('Kis Anna').getCell(2).value === '');

  check(
    "Nagy Zoltán's row shows 2600 Ft in BOTH day columns (joined both occurrences)",
    rowsByName.get('Nagy Zoltán').getCell(7).value === 2600 && rowsByName.get('Nagy Zoltán').getCell(8).value === 2600,
  );
  check(
    "Nagy Ilona (didn't join either breakfast) has blank event columns, not 0",
    rowsByName.get('Nagy Ilona').getCell(7).value == null && rowsByName.get('Nagy Ilona').getCell(8).value == null,
  );

  const familySubtotalRow = rowsByName.get('Nagy család összesen');
  check('a family subtotal row exists for the 2-person family', !!familySubtotalRow);
  check(
    'the family subtotal sums both members (2*667=1334, 2*134=268, 2*533=1066)',
    familySubtotalRow.getCell(4).value === 1334 && familySubtotalRow.getCell(5).value === 268 && familySubtotalRow.getCell(6).value === 1066,
  );
  check('the family subtotal row is bold', familySubtotalRow.getCell(1).font?.bold === true);
  check(
    "the family's event columns sum only Zoltán's participation (2600 each), Ilona contributed nothing",
    familySubtotalRow.getCell(7).value === 2600 && familySubtotalRow.getCell(8).value === 2600,
  );

  check('no subtotal row was created for the solo attendee', !rowsByName.has('Kis Anna összesen') && !rowsByName.has('Egyedülálló összesen'));

  const grandTotalRow = rowsByName.get('Mindösszesen');
  check('a grand total row exists', !!grandTotalRow);
  check(
    'the grand total matches the tour\'s own declared totals (2000/400/1600), not the inflated sum of rounded-up rows',
    grandTotalRow.getCell(4).value === 2000 && grandTotalRow.getCell(5).value === 400 && grandTotalRow.getCell(6).value === 1600,
  );
  check(
    'the grand total also sums each event column across every attendee (only Zoltán joined, so 2600 each)',
    grandTotalRow.getCell(7).value === 2600 && grandTotalRow.getCell(8).value === 2600,
  );
} finally {
  await User.deleteMany({ _id: { $in: [zoltanId, ilonaId, soloId] } });
  await Reservation.deleteMany({ tour: tour._id });
  await Tour.deleteOne({ _id: tour._id });
  console.log('\nCleaned up the throwaway test tour, reservations, and users.');
}

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

await mongoose.disconnect();
process.exit(0);
