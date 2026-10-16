import mongoose from 'mongoose';

// Megtekintések: one record per person, item and day - the first time
// that day this person really looked at a photo (2 s in the viewer),
// watched a video (30 s, or half of a shorter one), opened a tour's page
// or listened to a song (30 s). Seeing it again the same day changes
// nothing, the next day counts again - like YouTube's views, without the
// spam. So the records of an item are its views; their different users,
// its viewers. Written by POST /views (utils/views.js); for now only the
// totals are ever shown (the homepage's "Népszerű") - never who looked at
// what.
const viewSchema = new mongoose.Schema({
  type: { type: String, enum: ['photo', 'video', 'tour', 'track'], required: true },
  // Which one (utils/views.js's KEYS): "tour:<tourId>:<filename>" or
  // "media:<category>:<filename>" for a photo, the same with the video's
  // id for a video, the tour's id, a song's Jellyfin id.
  key: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The day in Budapest, "2026-10-16".
  day: { type: String, required: true },
  // When it was first seen that day.
  at: { type: Date, default: Date.now },
  // A song: the playlist it was played from - where the homepage plays it.
  playlist: String,
});
viewSchema.index({ type: 1, key: 1, user: 1, day: 1 }, { unique: true });
// The most viewed of a type in the last days.
viewSchema.index({ type: 1, day: 1 });

const View = mongoose.model('View', viewSchema);
export default View;
