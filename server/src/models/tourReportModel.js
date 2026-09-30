import mongoose from 'mongoose';

const { Schema } = mongoose;

// The header lines of a beszámoló - each one, when empty, is filled in from
// the tour itself (see tourReportController.js's autoFacts).
const factsSchema = new Schema(
  {
    place: { type: String, trim: true, default: '' },
    dates: { type: String, trim: true, default: '' },
    headcount: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

// A tour's beszámoló (what happened there, day by day), written by an
// admin on the tour page (see tourReportController.js). One per tour.
// `days` and `facts` are the working copy, saved as the admin types -
// only while `status` is 'draft'. Kész ('final') locks it and copies it
// into `published`: that's what the tour's attendees download as a PDF.
// Reopening (Visszanyitás) unlocks the working copy but keeps `published`
// until the next Kész, so the download never shows a half-edited text.
const tourReportSchema = new Schema(
  {
    tour: { type: Schema.Types.ObjectId, ref: 'Tour', required: true, unique: true },
    status: { type: String, enum: ['draft', 'final'], default: 'draft' },
    // One per day of the tour - the editor's own format (a Quill delta:
    // text with bold/italic, bullet and numbered lists, their levels). The
    // PDF is drawn from it.
    days: [{ type: Schema.Types.Mixed }],
    facts: { type: factsSchema, default: () => ({}) },
    // One of the tour's album photos (its file name - tourModel.js's
    // images), at the top of the PDF; none if unset.
    photo: { type: String, default: null },
    updatedByName: String,
    published: {
      days: [{ type: Schema.Types.Mixed }],
      facts: factsSchema,
      photo: String,
      at: Date,
      byName: String,
    },
  },
  { timestamps: true },
);

const TourReport = mongoose.model('TourReport', tourReportSchema);

export default TourReport;
