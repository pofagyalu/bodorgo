import mongoose from 'mongoose';

const { Schema } = mongoose;

// A fixed, curated list rather than free text - same reasoning as
// transactionModel.js's INCOME_CATEGORIES/EXPENSE_CATEGORIES: keeps the
// upload form's category dropdown predictable, extensible later with
// just a code change here (clubDocumentController.js validates against
// this, not a schema-level enum).
export const DOCUMENT_CATEGORIES = [
  'Alapdokumentumok',
  'Éves hivatalos dokumentumok',
  '1%-os felajánlások',
  'Számlák',
  'Egyéb',
];

// A club document (alapító okirat, éves adóbevallás, etc.) - viewable/
// downloadable by every logged-in member, but only an admin can upload or
// delete one (see clubDocumentController.js). The actual PDF lives on
// disk under server/documents/ (outside public/, so it's only reachable
// through the requireAuth-gated route - see documentController.js's own
// comment on why) - this document only ever stores its metadata.
const clubDocumentSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // The actual on-disk filename under documents/ - server-generated at
    // upload time (see clubDocumentController.js), never the original
    // uploaded filename, so it's always a safe, collision-free name.
    filename: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: DOCUMENT_CATEGORIES,
      default: 'Egyéb',
    },
    // Only meaningful for recurring yearly filings (category: 'Éves
    // hivatalos dokumentumok') - e.g. a given year's adóbevallás. Left
    // unset for anything else.
    year: {
      type: Number,
    },
    // Its small picture is ready (documents/previews/ - see
    // utils/documentPreviews.js); until then the card shows an icon.
    preview: {
      type: Boolean,
      default: false,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

const ClubDocument = mongoose.model('ClubDocument', clubDocumentSchema);

export default ClubDocument;
