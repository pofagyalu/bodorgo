// Read-only: the upcoming tours' stored forecast days and outlook.
import fs from 'fs';
import mongoose from 'mongoose';
const env = Object.fromEntries(
  fs
    .readFileSync('S:/bodorgo/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
await mongoose.connect(env.DB_URI);
const tours = await mongoose.connection.db
  .collection('tours')
  .find(
    { startDate: { $gt: new Date(Date.now() - 864e5 * 10) } },
    { projection: { order: 1, startDate: 1, duration: 1, dailyWeather: 1, weatherOutlook: 1 } },
  )
  .toArray();
for (const t of tours) {
  console.log(`tour ${t.order} start ${t.startDate.toISOString()} duration ${t.duration}`);
  const counts = {};
  for (const w of t.dailyWeather ?? []) counts[w.day] = (counts[w.day] ?? 0) + 1;
  for (const w of t.dailyWeather ?? [])
    console.log(
      `  day ${w.day} ${w.condition} ${w.tempDayC}/${w.tempNightC} rain ${w.rainChance}% fetched ${w.fetchedAt?.toISOString()} final ${w.isFinal}`,
    );
  console.log(
    '  duplicates:',
    Object.entries(counts).filter(([, n]) => n > 1),
  );
  const o = t.weatherOutlook;
  console.log(
    '  outlook:',
    o
      ? `${o.band ?? o.word ?? ''} updated ${o.updatedAt?.toISOString?.()} frozen ${o.frozen} note ${o.note}`
      : 'none',
  );
}
await mongoose.disconnect();
