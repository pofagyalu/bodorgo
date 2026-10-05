import mongoose from 'mongoose';

// Média → Videók: what an admin set for a video - its own title, when the
// one read from its file name isn't good enough, and who may see it. The
// videos themselves aren't in the database (see mediaVideoController.js) -
// only these are, by the category's key and the file's path inside the
// category folder. The file on the NAS is never renamed. A video with
// neither has no record here at all.
const mediaVideoTitleSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    path: { type: String, required: true },
    title: { type: String, trim: true, maxlength: 200 },
    // The only members who see the video (admins always do) - empty: every
    // member does.
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);
mediaVideoTitleSchema.index({ category: 1, path: 1 }, { unique: true });

const MediaVideoTitle = mongoose.model('MediaVideoTitle', mediaVideoTitleSchema);
export default MediaVideoTitle;
