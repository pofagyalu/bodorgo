import mongoose from 'mongoose';

// Média → Videók: what an admin set for a video - its own title, when the
// one read from its file name isn't good enough, and who may see it. The
// videos themselves aren't in the database (see mediaVideoController.js) -
// only these are, by the category's key and the file's path inside the
// category folder. The file on the NAS is never renamed. A video with no
// record (a new one, put on the NAS) is for the admins alone - see access.
const mediaVideoTitleSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    path: { type: String, required: true },
    title: { type: String, trim: true, maxlength: 200 },
    // Who sees it besides the admins (who always do): 'all' every member,
    // 'chosen' only the viewers below, 'admins' nobody else. None set (a new
    // video): the admins alone, until the role manager opens it up - a
    // forgotten switch never shows a video to anyone.
    access: { type: String, enum: ['all', 'chosen', 'admins'] },
    // The only members who see the video when access is 'chosen'.
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Made with AI: the page marks it "✦ AI" (as YouTube does).
    aiGenerated: { type: Boolean, default: false },
  },
  { timestamps: true },
);
mediaVideoTitleSchema.index({ category: 1, path: 1 }, { unique: true });

const MediaVideoTitle = mongoose.model('MediaVideoTitle', mediaVideoTitleSchema);
export default MediaVideoTitle;
