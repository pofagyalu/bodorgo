// Attaches a GPX track to a Futókör course: the loop to draw, its length
// and climb, and where the checkpoints are along it (with their positions).
//
//   node scripts/attachFutokorTrack.mjs <course name or part of it> <track.gpx> "lat,lng" "lat,lng" ...
//
// The positions are the checkpoints' in the order they're passed. A course
// that has no cards yet gets them: the START/FINISH card and the first
// free checkpoint cards, in order (T01 the 1st point, T02 the 2nd...). A
// course that already has its cards keeps them - then there must be as
// many positions as it has checkpoints.
//
// A dry run by default: it only says what it would do. Add --go to write.
// It works on the database DB_URI points at - the local dev one from .env;
// against production: DB_URI="<live, from S:/bodorgo/.env>" node scripts/...
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import { FutokorCourse, FutokorRun, FutokorTag } from '../src/models/futokorModels.js';
import { measureTrack, parseGpx, placeCheckpoints } from '../src/futokor/gpx.js';

const args = process.argv.slice(2).filter((a) => a !== '--go');
const go = process.argv.includes('--go');
const [courseName, gpxFile, ...positions] = args;
if (!courseName || !gpxFile) {
  console.error('Usage: attachFutokorTrack.mjs <course> <track.gpx> "lat,lng" ... [--go]');
  process.exit(1);
}

const points = parseGpx(fs.readFileSync(gpxFile, 'utf8'));
if (points.length < 2) throw new Error('No track in that file.');
const { distanceM, elevationGainM } = measureTrack(points);
const stops = positions.map((text) => {
  const [lat, lng] = text.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`Not a position: ${text}`);
  return { lat, lng };
});
const placed = placeCheckpoints(points, stops);

await mongoose.connect(process.env.DB_URI);
console.log(`Database: ${mongoose.connection.name}${go ? '' : '   (dry run - add --go to write)'}`);

const courses = await FutokorCourse.find({ name: new RegExp(courseName, 'i') });
if (courses.length !== 1) {
  console.error(
    `${courses.length} courses match "${courseName}":`,
    courses.map((c) => c.name),
  );
  await mongoose.disconnect();
  process.exit(1);
}
const course = courses[0];

// The cards: the course's own, or - if it has none - the first free ones.
let tagIds = course.checkpoints
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((c) => c.tagId);
if (!tagIds.length) {
  const tags = await FutokorTag.find({ retired: false }).sort('tagId');
  const start = tags.find((t) => t.kind === 'startFinish');
  const cards = tags.filter((t) => t.kind === 'checkpoint').slice(0, stops.length);
  if (!start || cards.length < stops.length) {
    throw new Error('Not enough cards: a START/FINISH card and one per checkpoint are needed.');
  }
  tagIds = [start.tagId, ...cards.map((t) => t.tagId)];
}
if (tagIds.length - 1 !== stops.length) {
  throw new Error(
    `The course has ${tagIds.length - 1} checkpoints, but ${stops.length} positions were given.`,
  );
}

course.track = points.map((p) => [p.lat, p.lng]);
course.distanceM = distanceM;
course.elevationGainM = elevationGainM;
course.checkpoints = [
  {
    tagId: tagIds[0],
    kind: 'startFinish',
    label: 'RAJT / CÉL',
    order: 0,
    distanceAlongM: 0,
    lat: points[0].lat,
    lng: points[0].lng,
  },
  ...stops.map((p, i) => ({
    tagId: tagIds[i + 1],
    kind: 'checkpoint',
    label: `${i + 1}. pont`,
    order: i + 1,
    distanceAlongM: placed[i].distanceAlongM,
    lat: p.lat,
    lng: p.lng,
  })),
];

console.log(
  `\n${course.name}: ${distanceM} m, +${elevationGainM} m, ${points.length} track points`,
);
for (const [i, c] of course.checkpoints.entries()) {
  const off = i > 0 ? `, ${placed[i - 1].offTrackM} m off the track` : '';
  console.log(`  ${c.label} · card ${c.tagId} · ${c.distanceAlongM} m${off}`);
}
const runs = await FutokorRun.countDocuments({ course: course._id });
if (runs) {
  console.log(
    `\n${runs} run(s) exist on it: save the course once on Pályák afterwards, so their splits follow the new distances.`,
  );
}

if (go) {
  await course.save();
  console.log('\nWritten.');
}
await mongoose.disconnect();
