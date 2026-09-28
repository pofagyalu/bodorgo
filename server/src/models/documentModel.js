import path from 'path';
import mongoose from 'mongoose';
import { CLUB_DOCUMENTS_DIR } from '../utils/dataDirs.js';

const { Schema } = mongoose;

// A fixed, curated list rather than free text - same reasoning as
// transactionModel.js's INCOME_CATEGORIES/EXPENSE_CATEGORIES: keeps the
// upload form's category dropdown predictable, extensible later with
// just a code change here (documentController.js validates against this,
// not a schema-level enum). Club documents only.
export const DOCUMENT_CATEGORIES = [
  'Alapdokumentumok',
  'Éves hivatalos dokumentumok',
  '1%-os felajánlások',
  'Számlák',
  'Egyéb',
];

// Every uploaded document, one mechanism for both kinds (see
// documentController.js):
// - a club document (Klub → Dokumentumok: alapító okirat, éves
//   adóbevallás…) - no tour; has a category, maybe a year, and a preview;
// - a tour's Extrák document (a map, a beszámoló…) - its tour set; at
//   most 5 per tour, no preview.
// Viewable by every logged-in user, uploaded and deleted by admins. The
// file lives under documents/ (outside public/ - only reachable through
// the login-gated /documents/:id/file route): a club one right there, a
// tour one in documents/tours/<tourId>/. This record only holds its
// metadata. (The collection keeps its old name, clubdocuments.)
const documentSchema = new Schema(
  {
    // Shown on the card - "Alapító okirat", "Szállás térkép".
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // On disk - server-generated at upload, never the uploaded file's own
    // name, so it's always safe and unique.
    filename: {
      type: String,
      required: true,
    },
    // A tour's Extrák document; unset for a club document.
    tour: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
      index: true,
    },
    category: {
      type: String,
      enum: DOCUMENT_CATEGORIES,
      default() {
        return this.tour ? undefined : 'Egyéb';
      },
    },
    // Only meaningful for recurring yearly filings (category: 'Éves
    // hivatalos dokumentumok') - e.g. a given year's adóbevallás.
    year: {
      type: Number,
    },
    // Its small picture is ready (documents/previews/ - see
    // utils/documentPreviews.js); club documents only.
    preview: {
      type: Boolean,
      default: false,
    },
    // Unset for the tour documents from before this collection held them.
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true, collection: 'clubdocuments' },
);

const MIME_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png' };

documentSchema.virtual('mimeType').get(function mimeType() {
  return MIME_TYPES[path.extname(this.filename).toLowerCase()] ?? 'application/octet-stream';
});

// Where its file is on disk.
export function documentFilePath(document) {
  return document.tour
    ? path.join(CLUB_DOCUMENTS_DIR, 'tours', String(document.tour), document.filename)
    : path.join(CLUB_DOCUMENTS_DIR, document.filename);
}

documentSchema.set('toJSON', { virtuals: true });

const Document = mongoose.model('Document', documentSchema);

export default Document;
