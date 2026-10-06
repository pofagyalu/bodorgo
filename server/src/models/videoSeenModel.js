import mongoose from 'mongoose';

// When "Új média felfedezése" first saw a video file - what its "Új" mark
// for the admins goes by (utils/newMedia.js). The videos themselves aren't
// in the database (they are read from their folders), so this is all that
// is kept of them. seenAt null: it was there at the first stock-taking, so
// it was never new. A record whose file is gone is harmless and stays.
const videoSeenSchema = new mongoose.Schema({
  area: { type: String, required: true }, // "tour", or "media:<category key>"
  path: { type: String, required: true }, // inside that area's folder, with "/"
  seenAt: { type: Date, default: null },
});
videoSeenSchema.index({ area: 1, path: 1 }, { unique: true });

const VideoSeen = mongoose.model('VideoSeen', videoSeenSchema);
export default VideoSeen;
