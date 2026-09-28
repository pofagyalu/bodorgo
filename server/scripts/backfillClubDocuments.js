// One-off: registers the two PDFs that were already sitting in
// documents/ by hand (before ClubDocument existed) as real records, so
// they show up in the Klub "Dokumentumok" list the same way anything
// uploaded from now on does, instead of being a separate hardcoded case.
// Safe to re-run - skips any filename that already has a record.
//
// Usage:
//   node scripts/backfillClubDocuments.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';
import ClubDocument from '../src/models/clubDocumentModel.js';

const DOCUMENTS = [
  { name: 'Klub alapító okirata', filename: 'alapito-okirat.pdf', category: 'Alapdokumentumok' },
  {
    name: 'Az első írásos emlék, ahol a „Bódorgó” név szerepel',
    filename: 'elso-irasos-emlek.pdf',
    category: 'Alapdokumentumok',
  },
];

await mongoose.connect(config.db.uri);

const admin = await User.findOne({ role: 'admin' }).sort('createdAt');
if (!admin) {
  console.error('No admin user found - cannot set uploadedBy.');
  await mongoose.disconnect();
  process.exit(1);
}

for (const doc of DOCUMENTS) {
  const existing = await ClubDocument.findOne({ filename: doc.filename });
  if (existing) {
    console.log(`Skipped ${doc.filename} - already registered.`);
    continue;
  }

  await ClubDocument.create({ ...doc, uploadedBy: admin._id });
  console.log(`Registered ${doc.filename} as "${doc.name}".`);
}

await mongoose.disconnect();
