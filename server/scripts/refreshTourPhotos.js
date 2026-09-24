// Combines matchTourFolders.js's single-tour folder-matching with
// syncTourImages.js's actual photo sync into one command - the common case
// (a tour whose folder hasn't been matched yet, or just wants a fresh
// sync) no longer needs two separate script invocations.
//
// Usage:
//   node scripts/refreshTourPhotos.js <tourId|order|slug>
//
// Connects to config.db.testUri, same as both scripts this wraps -
// override with DB_TEST_URI="<production DB_URI>" inline (not DB_URI - see
// both wrapped scripts' own connect line) to run against production
// instead of the local test DB.

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import { findFolderForOrder } from './matchTourFolders.js';
import { syncOneTour } from './syncTourImages.js';

const [, , identifier] = process.argv;
if (!identifier) {
  console.error('Usage: node scripts/refreshTourPhotos.js <tourId|order|slug>');
  process.exit(1);
}
if (!config.photosRoot || !config.thumbnailsRoot) {
  console.error('PHOTOS_ROOT and THUMBNAILS_ROOT must both be set (see .env.example).');
  process.exit(1);
}

await mongoose.connect(config.db.testUri);

let tour;
if (mongoose.isValidObjectId(identifier)) {
  tour = await Tour.findById(identifier).select('+images +sourceFolder');
} else if (/^\d+$/.test(identifier)) {
  tour = await Tour.findOne({ order: Number(identifier) }).select('+images +sourceFolder');
} else {
  tour = await Tour.findOne({ slug: identifier }).select('+images +sourceFolder');
}

if (!tour) {
  console.error(`No tour found matching "${identifier}" (tried id, order, and slug).`);
  await mongoose.disconnect();
  process.exit(1);
}

// Only attempts the match when sourceFolder is genuinely unset - an
// already-matched tour is left alone even if its folder happened to get
// renamed since (same "resolve by hand" stance matchTourFolders.js itself
// takes for a mismatch, rather than silently overwriting it here).
if (!tour.sourceFolder) {
  let folder;
  try {
    folder = findFolderForOrder(tour.order);
  } catch (err) {
    console.error(err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!folder) {
    console.error(
      `No photo folder found under PHOTOS_ROOT ending in a roman numeral for order ${tour.order} - set sourceFolder by hand if the folder name doesn't follow that convention.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  tour.sourceFolder = folder;
  await tour.save({ validateModifiedOnly: true });
  console.log(`Matched folder "${folder}" -> "${tour.title}" (order ${tour.order}).`);
}

try {
  const { message, subfolderNotices } = await syncOneTour(tour);
  subfolderNotices.forEach((n) => console.log(n));
  console.log(message);
} catch (err) {
  console.error(err.message);
  await mongoose.disconnect();
  process.exit(1);
}

await mongoose.disconnect();
