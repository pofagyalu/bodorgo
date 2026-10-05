// What a GPX track is: its length, its climb, where it starts and ends -
// and a page to look at it on a map.
//   node scripts/gpxInfo.mjs <track.gpx> [out.html]
import fs from 'fs';

const [input, output] = process.argv.slice(2);
const gpx = fs.readFileSync(input, 'utf8');

// Every track point, in order (all segments one after the other).
const points = [
  ...gpx.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g),
].map((m) => ({
  lat: Number(m[1]),
  lng: Number(m[2]),
  ele: /<ele>([^<]+)<\/ele>/.exec(m[3]) ? Number(/<ele>([^<]+)<\/ele>/.exec(m[3])[1]) : null,
}));

// Metres between two positions (haversine).
function metresBetween(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// How far along the track each point is.
let total = 0;
const along = points.map((p, i) => {
  if (i > 0) total += metresBetween(points[i - 1], p);
  return total;
});

// The climb and the descent: changes under 3 m from the last counted
// height are taken as noise.
let [gain, loss, ref] = [0, 0, points[0]?.ele];
for (const p of points) {
  if (p.ele === null || ref === null) continue;
  const d = p.ele - ref;
  if (Math.abs(d) >= 3) {
    if (d > 0) gain += d;
    else loss -= d;
    ref = p.ele;
  }
}
const eles = points.map((p) => p.ele).filter((e) => e !== null);

const info = {
  name: /<name>([^<]*)<\/name>/.exec(gpx)?.[1] ?? '',
  points: points.length,
  distanceM: Math.round(total),
  startToEndM: Math.round(metresBetween(points[0], points.at(-1))),
  elevationGainM: Math.round(gain),
  elevationLossM: Math.round(loss),
  lowestM: eles.length ? Math.min(...eles) : null,
  highestM: eles.length ? Math.max(...eles) : null,
};
console.log(JSON.stringify(info, null, 2));

if (output) {
  const track = points.map((p, i) => [p.lat, p.lng, Math.round(along[i])]);
  fs.writeFileSync(
    output,
    `<!doctype html>
<html lang="hu">
<meta charset="utf-8" />
<title>${info.name} – ${info.distanceM} m</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { height: 100%; margin: 0; }
  .box { position: absolute; z-index: 1000; top: 10px; right: 10px; padding: 10px 14px;
    background: #fff; border-radius: 12px; font: 600 15px system-ui; box-shadow: 0 2px 10px #0004; }
</style>
<div id="map"></div>
<div class="box">${info.name}: ${info.distanceM} m · ${info.points} pont · +${info.elevationGainM} m</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const track = ${JSON.stringify(track)};
  const map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  const line = L.polyline(track.map((p) => [p[0], p[1]]), { color: '#f07827', weight: 5 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [40, 40] });
  // Every point, with how far along the loop it is.
  track.forEach((p, i) =>
    L.circleMarker([p[0], p[1]], { radius: 4, color: '#1b6548', fillOpacity: 1 })
      .bindTooltip(i + '. pont · ' + p[2] + ' m').addTo(map));
  L.marker(track[0]).bindTooltip('RAJT / CÉL', { permanent: true }).addTo(map);
</script>
</html>
`,
  );
  console.log(`Map written to ${output}`);
}
