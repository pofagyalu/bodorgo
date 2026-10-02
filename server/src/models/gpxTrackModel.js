import mongoose from 'mongoose';

const { Schema } = mongoose;

// A GPX track the app was given: the file itself is on disk (utils/
// dataDirs.js's GPX_DIR, named by this record's id), this is what the app
// knows about it - who uploaded it, what it measures (futokor/gpx.js), and
// what it's for. One store for every kind: a Futókör course's loop now
// (`course`), a tour's hike later.
const gpxTrackSchema = new Schema(
  {
    // The file's own name, as it was uploaded ("COURSE_520472232.gpx").
    fileName: { type: String, required: true, trim: true },
    // What the track calls itself inside the file - '' if nothing.
    name: { type: String, default: '', trim: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sizeBytes: { type: Number, required: true },
    // How many track points the file has.
    points: { type: Number, required: true },
    distanceM: { type: Number, required: true },
    elevationGainM: { type: Number, default: null },
    elevationLossM: { type: Number, default: null },
    // Only a recorded track has these (a planned route has no times): when
    // it started, and how long from its first point to its last.
    startedAt: { type: Date, default: null },
    durationSec: { type: Number, default: null },
    // The Futókör course whose loop it is - null if it's for something else.
    course: { type: Schema.Types.ObjectId, ref: 'FutokorCourse', default: null },
  },
  { timestamps: true },
);

gpxTrackSchema.index({ course: 1 });

const GpxTrack = mongoose.model('GpxTrack', gpxTrackSchema);

export default GpxTrack;
