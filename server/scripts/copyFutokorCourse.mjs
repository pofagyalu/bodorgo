// Copies the Futókör cards and one course from one database to another -
// e.g. what was set up on the local dev database, to production.
//
//   FROM_DB_URI="<source>" DB_URI="<destination>" node scripts/copyFutokorCourse.mjs <course name or part of it> [--go]
//
// A dry run by default: it only says what it would do. Add --go to write.
// It only ever adds: a card that already exists in the destination is left
// as it is, and if the destination already has a course for that tour (or
// one open at the same time), nothing is written at all. Scans and runs are
// not copied. The course's tour and its maker are looked up in the
// destination (by id, then the tour by its title; the maker falls back to
// the role manager).
import mongoose from 'mongoose';
import { FutokorCourse, FutokorTag } from '../src/models/futokorModels.js';
import Tour from '../src/models/tourModel.js';
import User from '../src/models/userModel.js';

const go = process.argv.includes('--go');
const courseName = process.argv.slice(2).find((a) => a !== '--go');
const { FROM_DB_URI, DB_URI } = process.env;
if (!courseName || !FROM_DB_URI || !DB_URI) {
  console.error('Usage: FROM_DB_URI=... DB_URI=... copyFutokorCourse.mjs <course> [--go]');
  process.exit(1);
}

// The source, read only - on its own connection.
const from = await mongoose.createConnection(FROM_DB_URI).asPromise();
const tags = await from.collection('futokortags').find().sort({ tagId: 1 }).toArray();
const courses = await from
  .collection('futokorcourses')
  .find({ name: new RegExp(courseName, 'i') })
  .toArray();
if (courses.length !== 1) {
  console.error(`${courses.length} courses match "${courseName}" in ${from.name}.`);
  process.exit(1);
}
const course = courses[0];
const tour = await from.collection('tours').findOne({ _id: course.tour });
console.log(`From ${from.name}: ${tags.length} cards, "${course.name}" (tour: ${tour?.title})`);
await from.close();

await mongoose.connect(DB_URI);
console.log(`To ${mongoose.connection.name}${go ? '' : '   (dry run - add --go to write)'}`);

const have = new Set((await FutokorTag.find().select('tagId')).map((t) => t.tagId));
const newTags = tags.filter((t) => !have.has(t.tagId));
console.log(
  `  cards to add: ${newTags.map((t) => t.tagId).join(', ') || 'none'}` +
    (have.size ? `   (already there: ${[...have].join(', ')})` : ''),
);

const toTour =
  (await Tour.findById(course.tour).select('title')) ??
  (tour && (await Tour.findOne({ title: tour.title }).select('title')));
if (!toTour) throw new Error('The course’s tour is not in the destination.');
const maker =
  (await User.findById(course.createdBy).select('name')) ??
  (await User.findOne({ canManageRoles: true }).select('name'));
if (!maker) throw new Error('Nobody in the destination to be the course’s maker.');

const clash = await FutokorCourse.findOne({
  $or: [
    { tour: toTour._id },
    { opensAt: { $lte: course.closesAt }, closesAt: { $gte: course.opensAt } },
  ],
});
if (clash) {
  console.error(
    `  "${clash.name}" is already there (the same tour, or open at the same time) - nothing written.`,
  );
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`  course to add: "${course.name}" · tour "${toTour.title}" · made by ${maker.name}`);
console.log(`    open ${course.opensAt.toISOString()} - ${course.closesAt.toISOString()}`);
console.log(`    ${course.distanceM ?? '-'} m, ${course.track?.length ?? 0} track points`);
for (const c of course.checkpoints ?? []) {
  console.log(`    ${c.label} · card ${c.tagId} · ${c.distanceAlongM ?? '-'} m`);
}

if (go) {
  if (newTags.length) {
    await FutokorTag.insertMany(
      newTags.map((t) => ({ tagId: t.tagId, kind: t.kind, retired: t.retired })),
    );
  }
  const { _id, __v, createdAt, updatedAt, ...fields } = course;
  await FutokorCourse.create({ ...fields, tour: toTour._id, createdBy: maker._id });
  console.log('\nWritten.');
}
await mongoose.disconnect();
