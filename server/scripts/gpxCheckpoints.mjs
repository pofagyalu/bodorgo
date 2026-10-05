// Where checkpoints are along a GPX track: each is put onto the track at
// its nearest point - looking only after the previous checkpoint, so a
// loop passing the same spot twice gets them in the right order.
//   node scripts/gpxCheckpoints.mjs <track.gpx> "lat,lng" "lat,lng" ...
import fs from 'fs';

const [input, ...given] = process.argv.slice(2);
const gpx = fs.readFileSync(input, 'utf8');
const points = [...gpx.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g)].map((m) => ({
  lat: Number(m[1]),
  lng: Number(m[2]),
}));

function metresBetween(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// The track's stretches, each with where it starts along the track.
let total = 0;
const legs = points.slice(1).map((b, i) => {
  const a = points[i];
  const leg = { a, b, from: total, length: metresBetween(a, b) };
  total += leg.length;
  return leg;
});

// The nearest spot of a stretch to a position (flat-earth is fine at this
// size): how far along the stretch, and how far off it.
function onto(leg, p) {
  const k = Math.cos((leg.a.lat * Math.PI) / 180);
  const [ax, ay] = [leg.a.lng * k, leg.a.lat];
  const [bx, by] = [leg.b.lng * k, leg.b.lat];
  const [px, py] = [p.lng * k, p.lat];
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2
    ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2))
    : 0;
  const spot = {
    lat: leg.a.lat + (leg.b.lat - leg.a.lat) * t,
    lng: leg.a.lng + (leg.b.lng - leg.a.lng) * t,
  };
  return { along: leg.from + leg.length * t, off: metresBetween(spot, p) };
}

let after = 0;
const rows = given.map((text, i) => {
  const [lat, lng] = text.split(',').map(Number);
  // Every stretch's nearest spot that lies after the previous checkpoint;
  // the first one that is close enough wins over a later, slightly closer
  // pass of the same place.
  const hits = legs.map((leg) => onto(leg, { lat, lng })).filter((h) => h.along > after + 1);
  const best = Math.min(...hits.map((h) => h.off));
  const hit = hits.find((h) => h.off <= best + 10);
  after = hit.along;
  return { point: i + 1, distanceAlongM: Math.round(hit.along), offTrackM: Math.round(hit.off) };
});

console.table(rows);
console.log(`Loop: ${Math.round(total)} m`);
let prev = 0;
for (const r of [...rows, { point: 'CÉL', distanceAlongM: Math.round(total) }]) {
  console.log(`  → ${r.point}: ${r.distanceAlongM - prev} m`);
  prev = r.distanceAlongM;
}
