import mongoose from 'mongoose';

// Who used the app on which day - one record per person and day, written
// on their first request of the day (utils/activity.js, from requireAuth):
// a session lasts 90 days, so logins alone can't tell who comes back. With
// what they used it on that day, and whether the installed app was among
// it. Only ever shown in totals (Klub → Statisztika).
const activeDaySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The day in Budapest, "2026-10-16".
  day: { type: String, required: true },
  devices: [{ type: String, enum: ['phone', 'tablet', 'desktop'] }],
  // The installed app (the phone's home screen icon) was used that day.
  app: { type: Boolean, default: false },
});
activeDaySchema.index({ user: 1, day: 1 }, { unique: true });
activeDaySchema.index({ day: 1 });

const ActiveDay = mongoose.model('ActiveDay', activeDaySchema);
export default ActiveDay;
