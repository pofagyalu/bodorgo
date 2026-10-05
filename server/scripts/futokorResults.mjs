// A Futókör course's results from the database DB_URI points at - read
// only: every scan as it arrived, and every run with its splits.
//   node scripts/futokorResults.mjs [course name or part of it]
// (Against production: DB_URI="<live>" node scripts/futokorResults.mjs)
import 'dotenv/config';
import mongoose from 'mongoose';
import { FutokorCourse, FutokorRun, FutokorScan } from '../src/models/futokorModels.js';
import User from '../src/models/userModel.js';

const time = (ms) => {
  if (ms == null) return '-';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pace = (sec) =>
  sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /km` : '-';
const clock = (d) => new Date(d).toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest' });

await mongoose.connect(process.env.DB_URI);
const name = process.argv[2] ?? '';
for (const course of await FutokorCourse.find({ name: new RegExp(name, 'i') })) {
  const label = (id) => course.checkpoints.find((c) => c.tagId === id)?.label ?? id;
  console.log(
    `\n=== ${course.name} (${mongoose.connection.name}) - ${course.distanceM ?? '-'} m ===`,
  );

  const scans = await FutokorScan.find({ course: course._id }).sort('deviceTime').lean();
  const users = new Map(
    (await User.find({ _id: { $in: scans.map((s) => s.user) } }).select('name')).map((u) => [
      String(u._id),
      u.name,
    ]),
  );
  console.log(`\nScans (${scans.length}):`);
  for (const s of scans) {
    const lag = Math.round((s.serverTime - s.deviceTime) / 1000);
    console.log(
      `  ${clock(s.deviceTime)}  ${users.get(String(s.user))}  ${
        s.action === 'giveUp' ? 'gave up' : `${label(s.tagId)} (${s.tagId})`
      }${s.action === 'restart' ? ' [restart]' : ''}  · reached the server ${lag}s later`,
    );
  }

  const runs = await FutokorRun.find({ course: course._id }).sort('startedAt').lean();
  console.log(`\nRuns (${runs.length}):`);
  for (const r of runs) {
    console.log(
      `  ${users.get(String(r.user)) ?? r.user}  ${clock(r.startedAt)}  ${r.status}  ` +
        `${time(r.totalMs)}  ${pace(r.paceSecPerKm)}  points: ${r.passed}${r.flagged ? '  FLAGGED' : ''}`,
    );
    for (const s of r.splits) {
      console.log(
        `      ${label(s.fromCheckpointId)} → ${label(s.toCheckpointId)}: ${time(s.ms)}  ` +
          `${s.distanceM ?? '-'} m  ${pace(s.paceSecPerKm)}  ${s.speedMps ? s.speedMps.toFixed(2) + ' m/s' : ''}`,
      );
    }
  }
}
await mongoose.disconnect();
