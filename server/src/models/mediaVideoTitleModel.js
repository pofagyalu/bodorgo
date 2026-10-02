import mongoose from 'mongoose';

// Média → Videók: an admin's own title for a video, when the one read from
// its file name isn't good enough. The videos themselves aren't in the
// database (see mediaVideoController.js) - only these corrections are, by
// the category's key and the file's path inside the category folder. The
// file on the NAS is never renamed.
const mediaVideoTitleSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    path: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);
mediaVideoTitleSchema.index({ category: 1, path: 1 }, { unique: true });

const MediaVideoTitle = mongoose.model('MediaVideoTitle', mediaVideoTitleSchema);
export default MediaVideoTitle;
