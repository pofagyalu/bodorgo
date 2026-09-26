import mongoose from 'mongoose';

const { Schema } = mongoose;

// A letter to a tour's attendees, written by an admin on the tour page
// (see mailingController.js). Each tour has at most one 'draft' - saved as
// the admin types - which becomes 'sent' when mass-mailed, and is never
// changed after that: the sent ones are the record of what went out.
const tourMailingSchema = new Schema(
  {
    tour: { type: Schema.Types.ObjectId, ref: 'Tour', required: true, index: true },
    status: { type: String, enum: ['draft', 'sent'], default: 'draft' },
    subject: { type: String, trim: true, default: '' },
    // Cleaned HTML (see utils/mailHtml.js) - exactly what goes into the e-mail.
    html: { type: String, default: '' },
    // The editor's own format (a Quill delta), so reopening a draft brings
    // back its formatting exactly. Not used for sending.
    delta: { type: Schema.Types.Mixed },
    withPdf: { type: Boolean, default: false },
    updatedByName: String,
    sentAt: Date,
    sentByName: String,
    recipients: [{ _id: false, name: String, email: String }],
    skipped: [{ _id: false, name: String, reason: String }],
  },
  { timestamps: true },
);

const TourMailing = mongoose.model('TourMailing', tourMailingSchema);

export default TourMailing;
