// Lists the Futókör courses of the database DB_URI points at - read only.
//   node scripts/futokorCourses.mjs
// (Against production: DB_URI="<live>" node scripts/futokorCourses.mjs)
import 'dotenv/config';
import mongoose from 'mongoose';
import { FutokorCourse, FutokorRun, FutokorScan, FutokorTag } from '../src/models/futokorModels.js';

await mongoose.connect(process.env.DB_URI);
console.log(`Database: ${mongoose.connection.name}`);
const tags = await FutokorTag.find().sort('tagId').lean();
console.log(`Cards: ${tags.map((t) => t.tagId + (t.retired ? ' (letiltva)' : '')).join(', ')}`);
for (const c of await FutokorCourse.find().lean()) {
  console.log(`\n${c.name}  [${c._id}]`);
  console.log(`  open: ${c.opensAt.toISOString()} - ${c.closesAt.toISOString()}`);
  console.log(`  loop: ${c.distanceM ?? '-'} m, track points: ${c.track?.length ?? 0}`);
  for (const cp of c.checkpoints) {
    console.log(
      `  ${cp.order}. ${cp.label} · card ${cp.tagId} · ${cp.distanceAlongM ?? '-'} m · ${cp.lat ?? '-'}, ${cp.lng ?? '-'}`,
    );
  }
  console.log(
    `  scans: ${await FutokorScan.countDocuments({ course: c._id })}, runs: ${await FutokorRun.countDocuments({ course: c._id })}`,
  );
}
await mongoose.disconnect();
