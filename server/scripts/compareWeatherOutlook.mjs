// A tour's stored forecast and outlook (Életviteli tanácsok) in the dev and
// the live database side by side - each keeps its own copy, fetched at its
// own time, so their indexes can differ. Reads only.
// Run from server/:
//   node scripts/compareWeatherOutlook.mjs 32
import fs from 'fs';
import mongoose from 'mongoose';

const valueFrom = (envFile, key) =>
  fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`))
    ?.slice(key.length + 1)
    .trim();

const order = Number(process.argv[2]);
if (!order) throw new Error('Which tour? Its number, e.g. 32');

const time = (d) => (d ? new Date(d).toLocaleString('hu-HU') : '-');

for (const [name, envFile] of [
  ['dev', '.env'],
  ['live', 'S:/bodorgo/.env'],
]) {
  const db = await mongoose.createConnection(valueFrom(envFile, 'DB_URI')).asPromise();
  const tour = await db
    .collection('tours')
    .findOne({ order }, { projection: { title: 1, dailyWeather: 1, weatherOutlook: 1 } });
  console.log(`\n${name} (${db.name}): ${tour?.title ?? 'no such tour'}`);
  const scores = new Map((tour?.weatherOutlook?.days ?? []).map((d) => [d.day, d.score]));
  for (const w of [...(tour?.dailyWeather ?? [])].sort((a, b) => a.day - b.day)) {
    console.log(
      `  day ${w.day}: ${String(w.condition).padEnd(14)} ${w.tempNightC}..${w.tempDayC} °C` +
        `  rain ${w.rainChance ?? '-'}%  wind ${w.windSpeedKmh ?? '-'} km/h` +
        `  score ${scores.get(w.day) ?? '-'}  fetched ${time(w.fetchedAt)}${w.isFinal ? '  FINAL' : ''}`,
    );
  }
  console.log(
    `  index: ${tour?.weatherOutlook?.score ?? '-'} (${tour?.weatherOutlook?.tier ?? '-'})`,
  );
  await db.close();
}
