import mongoose from 'mongoose';

// Média → Fotók: what the role manager set for a folder - a category
// (album: '') or one of its albums (album: the subfolder's name): a name
// instead of the folder's, who may see it, and - an album only - which of
// its photos is on its card. A folder with none of these has no record
// here.
//
// Kept apart from the photos' records (mediaPhotoModel.js), like
// mediaPhotoSettingsModel.js: those come and go with the files.
const mediaPhotoFolderSchema = new mongoose.Schema(
  {
    category: { type: String, required: true }, // the folder's name
    album: { type: String, default: '' }, // the subfolder's - '': the category itself
    title: { type: String, trim: true, maxlength: 200 },
    // The only members who see it (admins always do) - empty: every member
    // does.
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // An album's cover: the photo's filename ("2019/IMG_1.jpg").
    cover: String,
  },
  { timestamps: true },
);
mediaPhotoFolderSchema.index({ category: 1, album: 1 }, { unique: true });

const MediaPhotoFolder = mongoose.model('MediaPhotoFolder', mediaPhotoFolderSchema);
export default MediaPhotoFolder;
