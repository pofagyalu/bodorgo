// One-time helper for the tour photo gallery (see
// tour-photos-implementation-plan.md): every folder under PHOTOS_ROOT ends
// in a roman numeral that's identical to that tour's `order` field -
// confirmed against all 31 real folders (e.g. "...bodorgo_xxii" is the
// 22nd tour, "...MTB_bodorgo_xxix" the 29th). This fills in
// Tour.sourceFolder by matching that numeral to Tour.order, instead of
// typing ~30 folder names in by hand.
//
// Dry-run by default (prints what it would do, writes nothing) - pass
// --apply to actually save. Safe to re-run any time new folders/tours
// show up; already-matched tours are just skipped.
//
// Usage:
//   node scripts/matchTourFolders.js [--apply]

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanToInt(roman) {
  const s = roman.toUpperCase();
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const value = ROMAN_VALUES[s[i]];
    if (value === undefined) return null;
    const next = ROMAN_VALUES[s[i + 1]];
    total += next !== undefined && value < next ? -value : value;
  }
  return total;
}

// Matches the trailing "_<roman numeral>" at the end of a folder name,
// whatever descriptive text precedes it - some real folders don't even
// contain the word "bodorgo" (e.g. "..._sarkany_panzio_xxviii").
const TRAILING_NUMERAL_RE = /_([ivxlcdm]+)$/i;

if (!config.photosRoot) {
  console.error('PHOTOS_ROOT is not set (see .env.example).');
  process.exit(1);
}

const apply = process.argv.includes('--apply');

await mongoose.connect(config.db.testUri);

const entries = fs.readdirSync(config.photosRoot, { withFileTypes: true });
const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

let matched = 0;
let alreadySet = 0;
let noNumeral = 0;
let noTour = 0;
let conflicts = 0;

for (const folder of folders) {
  const m = folder.match(TRAILING_NUMERAL_RE);
  if (!m) {
    console.log(`?  "${folder}" - no trailing roman numeral found, skipped.`);
    noNumeral++;
    continue;
  }

  const order = romanToInt(m[1]);
  const candidates = await Tour.find({ order }).select('title +sourceFolder');

  if (candidates.length === 0) {
    console.log(`-  "${folder}" -> order ${order}: no tour with this order yet (not an error - upload it later and re-run).`);
    noTour++;
    continue;
  }
  if (candidates.length > 1) {
    console.log(`!  "${folder}" -> order ${order}: ${candidates.length} tours share this order - resolve by hand.`);
    conflicts++;
    continue;
  }

  const tour = candidates[0];
  if (tour.sourceFolder === folder) {
    alreadySet++;
    continue;
  }
  if (tour.sourceFolder && tour.sourceFolder !== folder) {
    console.log(
      `!  "${folder}" -> "${tour.title}" already has a different sourceFolder ("${tour.sourceFolder}") - resolve by hand.`,
    );
    conflicts++;
    continue;
  }

  console.log(`OK "${folder}" -> "${tour.title}" (order ${order})${apply ? '' : '  [dry-run]'}`);
  matched++;
  if (apply) {
    await Tour.updateOne({ _id: tour._id }, { $set: { sourceFolder: folder } });
  }
}

console.log(
  `\n${matched} matched${apply ? '' : ' (dry-run - pass --apply to write)'}, ${alreadySet} already set, ${noTour} with no tour yet, ${noNumeral} with no numeral, ${conflicts} conflict(s) to resolve by hand.`,
);

await mongoose.disconnect();
