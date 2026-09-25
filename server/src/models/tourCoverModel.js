import mongoose from 'mongoose';

const { Schema } = mongoose;

// A tour's cover image (one JPEG per tour), stored in the database rather
// than as a file under public/img/tours - same reasons as userPhotoModel.js:
// the local dev app and production share one database, so a cover uploaded
// from either works in both right away, and nothing about it is ever
// publicly reachable (served only through the requireAuth-gated
// GET /tours/:id/cover). The browser shrinks it before upload (see the
// client's tour-edit page), so each is a few hundred KB at most. Kept out
// of the Tour document so tour list queries never carry image bytes.
const tourCoverSchema = new Schema(
  {
    tour: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
      required: true,
      unique: true,
    },
    data: {
      type: Buffer,
      required: true,
    },
    contentType: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

const TourCover = mongoose.model('TourCover', tourCoverSchema);

export default TourCover;
