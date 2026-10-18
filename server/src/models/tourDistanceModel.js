import mongoose from 'mongoose';

// The driving route from someone's home to a tour (OpenRouteService), as
// it was last worked out - kept, since it only changes when one of the two
// places does (utils/tourDistances.js). `from` / `to` are the places it was
// worked out between: either moved, and it is worked out again.
const place = { lat: { type: Number, required: true }, lng: { type: Number, required: true } };

const tourDistanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tour: { type: mongoose.Schema.Types.ObjectId, ref: 'Tour', required: true },
  from: place,
  to: place,
  distanceKm: { type: Number, required: true },
  durationMinutes: { type: Number, required: true },
  computedAt: { type: Date, default: Date.now },
});

tourDistanceSchema.index({ user: 1, tour: 1 }, { unique: true });

export default mongoose.model('TourDistance', tourDistanceSchema);
