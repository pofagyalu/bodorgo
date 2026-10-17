// Past tours left bare get something to show:
// - a tour that has ended and has no Program at all gets three plain lines:
//   the arrival, every whole day between, the departure;
// - a tour whose description - or short description (summary) - is only a
//   few characters (a placeholder like "asdf") gets a sentence in its place.
// A dry run unless --go is given: it only lists what it would do.
//   node scripts/fillEmptyPrograms.mjs [--go]
// (Against production: DB_URI="<live>" node scripts/fillEmptyPrograms.mjs)
import 'dotenv/config';
import mongoose from 'mongoose';
import Tour from '../src/models/tourModel.js';

const go = process.argv.includes('--go');

const ARRIVAL = { time: '14:00', description: 'Megérkeztünk' };
const WHOLE_DAY = { time: '08:00', description: 'Egész nap jól éreztük magunkat' };
const DEPARTURE = { time: '10:00', description: 'Elhagytuk a szállást' };
const DESCRIPTION = 'Ez a hely nagyon vagány és tuti jó lesz itt.';
// A description shorter than this (its letters, without any HTML) is a
// placeholder.
const SHORT = 20;

const textOf = (html) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// The tour's last day is over.
const hasEnded = (tour, now) =>
  tour.startDate.getTime() + tour.duration * 24 * 3600 * 1000 < now.getTime();

function programFor(duration) {
  const days = [{ day: 1, ...ARRIVAL }];
  for (let day = 2; day < duration; day += 1) days.push({ day, ...WHOLE_DAY });
  if (duration > 1) days.push({ day: duration, ...DEPARTURE });
  return days.map((d) => ({ ...d, isOptional: false, participants: [] }));
}

await mongoose.connect(process.env.DB_URI);
console.log(`Database: ${mongoose.connection.name}${go ? '' : '  (dry run - nothing is changed)'}`);

const now = new Date();
const tours = await Tour.find()
  .select('order title startDate duration schedule description summary closed')
  .sort('startDate')
  .lean();
let programs = 0;
let descriptions = 0;
let summaries = 0;
for (const tour of tours) {
  const ended = hasEnded(tour, now);
  const name = `${tour.order ?? '?'}. ${tour.title} (${tour.startDate.toISOString().slice(0, 10)}, ${tour.duration} nap${tour.closed ? ', lezárva' : ''}${ended ? '' : ', MÉG NEM VOLT'})`;
  const set = {};

  if (ended && !(tour.schedule ?? []).length) {
    set.schedule = programFor(tour.duration);
    programs += 1;
    console.log(`\nPROGRAM  ${name}`);
    for (const e of set.schedule) console.log(`    ${e.day}. nap ${e.time}  ${e.description}`);
  }

  const text = textOf(tour.description);
  if (ended && text.length < SHORT && text !== DESCRIPTION) {
    set.description = DESCRIPTION;
    descriptions += 1;
    console.log(`\nLEÍRÁS   ${name}\n    most: "${text}"`);
  } else if (!ended && text.length < SHORT) {
    console.log(`\n(kimarad, még nem volt)  ${name}\n    leírás most: "${text}"`);
  }

  // The short description (the tour card's line): the same.
  const short = textOf(tour.summary);
  if (ended && short.length < SHORT && short !== DESCRIPTION) {
    set.summary = DESCRIPTION;
    summaries += 1;
    console.log(`
RÖVID    ${name}
    most: "${short}"`);
  }

  // (updateOne: none of the tour's save hooks - the distance, the weather -
  // have anything to do with this.)
  if (go && Object.keys(set).length) await Tour.updateOne({ _id: tour._id }, { $set: set });
}

console.log(
  `\n${tours.length} tábor: ${programs} kap programot, ${descriptions} kap leírást, ${summaries} rövid leírást.${go ? ' Kész.' : ' (--go: végre is hajtja)'}`,
);
await mongoose.disconnect();
