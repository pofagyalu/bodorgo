import mongoose from 'mongoose';

// Média → Fotók: one record per photo in a subfolder of MEDIA_PHOTOS_ROOT
// (the NAS's bódorgó_egyéb - each subfolder is a category, e.g. "sinners").
// A folder inside a category is an album of it (e.g. "farsangok/2019"): its
// photos carry the album's name, in `album` and in front of the filename.
// Written only by "Új média felfedezése" (photos/mediaPhotoSync.js); the
// width/height are what the lightbox needs upfront.
const mediaPhotoSchema = new mongoose.Schema({
  category: { type: String, required: true }, // the subfolder's name
  // The album's folder - none on a photo that sits in the category itself.
  album: String,
  filename: { type: String, required: true }, // "IMG_1.jpg", or "2019/IMG_1.jpg" in an album
  width: Number,
  height: Number,
  size: Number,
  takenAt: Date,
  // When "Új média felfedezése" recorded it - its "Új" mark for the admins
  // goes by this (utils/newMedia.js); the ones from before have none.
  addedAt: Date,
});
mediaPhotoSchema.index({ category: 1, filename: 1 }, { unique: true });
mediaPhotoSchema.index({ category: 1, album: 1 });

const MediaPhoto = mongoose.model('MediaPhoto', mediaPhotoSchema);
export default MediaPhoto;
