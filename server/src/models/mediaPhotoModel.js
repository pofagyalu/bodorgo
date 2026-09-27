import mongoose from 'mongoose';

// Média → Fotók: one record per photo in a subfolder of MEDIA_PHOTOS_ROOT
// (the NAS's bódorgó_egyéb - each subfolder is a category, e.g. "sinners").
// Written only by "Új média felfedezése" (photos/mediaPhotoSync.js); the
// width/height are what the lightbox needs upfront.
const mediaPhotoSchema = new mongoose.Schema({
  category: { type: String, required: true }, // the subfolder's name
  filename: { type: String, required: true },
  width: Number,
  height: Number,
  size: Number,
  takenAt: Date,
});
mediaPhotoSchema.index({ category: 1, filename: 1 }, { unique: true });

const MediaPhoto = mongoose.model('MediaPhoto', mediaPhotoSchema);
export default MediaPhoto;
