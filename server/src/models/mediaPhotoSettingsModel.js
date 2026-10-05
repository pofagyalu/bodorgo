import mongoose from 'mongoose';

// Média → Fotók: what an admin set for a photo - a name (a photo has none
// of its own: the file's is never shown), and who may see it. A photo with
// neither has no record here.
//
// Kept apart from the photo's own record (mediaPhotoModel.js) on purpose:
// that one goes whenever the file is away at an "Új média felfedezése" and
// comes back new - and a photo kept for a few must not come back open to
// everyone.
const mediaPhotoSettingsSchema = new mongoose.Schema(
  {
    category: { type: String, required: true }, // the subfolder's name
    filename: { type: String, required: true },
    title: { type: String, trim: true, maxlength: 200 },
    // The only members who see the photo (admins always do) - empty: every
    // member does.
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);
mediaPhotoSettingsSchema.index({ category: 1, filename: 1 }, { unique: true });

const MediaPhotoSettings = mongoose.model('MediaPhotoSettings', mediaPhotoSettingsSchema);
export default MediaPhotoSettings;
