import ActiveDay from '../models/activeDayModel.js';
import logger from '../logger.js';
import { budapestYmd } from './huDate.js';

// Who used the app on which day (models/activeDayModel.js). requireAuth
// calls noteActive on every request; only the first of the day per person
// and device reaches the database - the rest are known here already.

// What a browser says it runs on: a tablet, a phone, or else a computer.
// (An iPad's Safari says it is a Mac: it counts as a computer.)
export function deviceOf(userAgent = '') {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return 'phone';
  return 'desktop';
}

// "user|device" already written today - forgotten when the day changes.
let today = '';
let noted = new Set();

export function clearActivityMemory() {
  today = '';
  noted = new Set();
}

// Never in the request's way: not waited for, and a failure is only logged.
export function noteActive(user, req) {
  const day = budapestYmd();
  if (day !== today) {
    today = day;
    noted = new Set();
  }
  const device = deviceOf(req.get?.('user-agent'));
  const key = `${user._id}|${device}`;
  if (noted.has(key)) return;
  noted.add(key);
  ActiveDay.updateOne(
    { user: user._id, day },
    { $addToSet: { devices: device } },
    { upsert: true },
  ).catch((err) => {
    noted.delete(key);
    logger.warn(`activity not recorded: ${err.message}`);
  });
}

// The installed app was used today (POST /views/app - the app says so
// itself, a browser can't tell).
export async function noteInstalledApp(user) {
  await ActiveDay.updateOne(
    { user: user._id, day: budapestYmd() },
    { $set: { app: true } },
    {
      upsert: true,
    },
  );
}
