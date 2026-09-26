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
import { pathToFileURL } from 'url';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToInt(roman) {
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
export const TRAILING_NUMERAL_RE = /_([ivxlcdm]+)$/i;

// Single-tour equivalent of this script's own bulk loop below (which
// converts every folder's numeral and matches it against every tour) -
// used by refreshTourPhotos.js so it doesn't have to re-scan the whole
// PHOTOS_ROOT for a script that only cares about one tour. Returns null if
// no folder matches; throws if more than one folder resolves to the same
// order (a real conflict to resolve by hand, same as the bulk script's own
// "conflicts" case below).
export function findFolderForOrder(order) {
  const entries = fs.readdirSync(config.photosRoot, { withFileTypes: true });
  const matches = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((folder) => {
      const m = folder.match(TRAILING_NUMERAL_RE);
      return m && romanToInt(m[1]) === order;
    });

  if (matches.length > 1) {
    throw new Error(
      `Multiple folders match order ${order}: ${matches.join(', ')} - resolve by hand.`,
    );
  }
  return matches[0] ?? null;
}

// Guarded so refreshTourPhotos.js (and anything else) can import
// romanToInt/TRAILING_NUMERAL_RE/findFolderForOrder above without also
// running this whole bulk CLI body - same isMain pattern as
// syncTourImages.js, for the same reason.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}

async function main() {
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
      console.log(
        `-  "${folder}" -> order ${order}: no tour with this order yet (not an error - upload it later and re-run).`,
      );
      noTour++;
      continue;
    }
    if (candidates.length > 1) {
      console.log(
        `!  "${folder}" -> order ${order}: ${candidates.length} tours share this order - resolve by hand.`,
      );
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
}
