// Builds the quiz's own map (Móka → Kvíz → a map question): Hungary and
// all its neighbours drawn from Natural Earth's public-domain data - countries, rivers,
// lakes, and not a single name. The result is a small file shipped with the
// client (client/src/assets/maps/quiz-map.json), drawn there by Leaflet
// (pages/moka/quiz/quiz-map) - no map provider is asked for anything.
//
//   node scripts/buildQuizMap.mjs <folder with the Natural Earth files> [out.json] [look.svg]
//
// The folder needs these, from
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson :
//   ne_10m_admin_0_countries.geojson
//   ne_10m_rivers_lake_centerlines.geojson, ne_10m_rivers_europe.geojson
//   ne_10m_lakes.geojson, ne_10m_lakes_europe.geojson
// With a third argument it also writes a picture of the whole map (SVG).
import fs from 'fs';
import path from 'path';

const [dir, out = '../client/src/assets/maps/quiz-map.json', look] = process.argv.slice(2);
if (!dir) throw new Error('Which folder are the Natural Earth files in?');

// Hungary with every one of its neighbours whole (Austria, Slovakia,
// Ukraine, Romania, Serbia, Croatia, Slovenia) - so the Carpathian basin,
// where the club's tours are, with plenty around it. Everything is cut to
// this box - nothing outside it is in the file.
const BOX = { west: 9.0, south: 41.8, east: 40.6, north: 52.8 };
const { west: W, south: S, east: E, north: N } = BOX;

const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(dir, `${name}.geojson`), 'utf8')).features;

function bbox(points) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}
const near = (points) => {
  const [w, s, e, n] = bbox(points);
  return !(e < W || w > E || n < S || s > N);
};

// Douglas-Peucker: the points that matter at this tolerance (in degrees).
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [dx, dy] = [points[b][0] - ax, points[b][1] - ay];
    const length2 = dx * dx + dy * dy;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tol * tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Simplified, rounded to about 100 m, without points that became the same.
function tidy(points, tol) {
  const result = [];
  for (const [x, y] of simplify(points, tol)) {
    const q = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
    const last = result.at(-1);
    if (!last || last[0] !== q[0] || last[1] !== q[1]) result.push(q);
  }
  return result;
}

// A ring cut to the box (Sutherland-Hodgman, one side at a time).
function clipRing(ring) {
  const atX = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const atY = (y) => (a, b) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  const sides = [
    [(p) => p[0] >= W, atX(W)],
    [(p) => p[0] <= E, atX(E)],
    [(p) => p[1] >= S, atY(S)],
    [(p) => p[1] <= N, atY(N)],
  ];
  let points = ring.slice(0, -1);
  for (const [inside, cross] of sides) {
    const cut = [];
    points.forEach((cur, i) => {
      const prev = points.at(i - 1);
      if (inside(cur)) {
        if (!inside(prev)) cut.push(cross(prev, cur));
        cut.push(cur);
      } else if (inside(prev)) cut.push(cross(prev, cur));
    });
    points = cut;
    if (!points.length) return [];
  }
  return [...points, points[0]];
}

// The pieces of a line that are in the box.
function clipLine(line) {
  const pieces = [];
  let cur = [];
  for (const p of line) {
    if (p[0] >= W && p[0] <= E && p[1] >= S && p[1] <= N) cur.push(p);
    else if (cur.length) {
      pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length) pieces.push(cur);
  return pieces.filter((p) => p.length >= 2);
}

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const linesOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);
// Wide or tall enough to be worth drawing (in degrees).
const bigEnough = (ring, span) => {
  if (ring.length < 4) return false;
  const [w, s, e, n] = bbox(ring);
  return e - w >= span || n - s >= span;
};

// --- The land: each country's part of the box ---
const land = [];
for (const f of load('ne_10m_admin_0_countries')) {
  const polys = [];
  for (const poly of polygonsOf(f.geometry)) {
    if (!near(poly[0])) continue;
    const [outer, ...holes] = poly.map((r) => tidy(clipRing(r), 0.004));
    if (bigEnough(outer, 0.03)) polys.push([outer, ...holes.filter((r) => bigEnough(r, 0.05))]);
  }
  if (polys.length) land.push(polys);
}

// --- Rivers: the big ones are drawn thicker ---
const rivers = [];
const streams = [];
let seen = new Set();
for (const name of ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe']) {
  for (const f of load(name)) {
    if (!f.geometry) continue;
    const rank = f.properties.scalerank ?? 99;
    for (const line of linesOf(f.geometry)) {
      if (line.length < 2 || !near(line)) continue;
      for (const piece of clipLine(line)) {
        const points = tidy(piece, 0.004);
        const key = `${points[0]}|${points.at(-1)}|${points.length}`;
        if (points.length < 2 || seen.has(key)) continue;
        seen.add(key);
        (rank <= 6 ? rivers : streams).push(points);
      }
    }
  }
}

// --- Lakes ---
const lakes = [];
seen = new Set();
for (const name of ['ne_10m_lakes', 'ne_10m_lakes_europe']) {
  for (const f of load(name)) {
    for (const poly of polygonsOf(f.geometry)) {
      if (!near(poly[0])) continue;
      const ring = tidy(clipRing(poly[0]), 0.003);
      if (!bigEnough(ring, 0.03) || seen.has(String(ring[0]))) continue;
      seen.add(String(ring[0]));
      lakes.push([ring]);
    }
  }
}

const data = {
  source: 'Natural Earth (naturalearthdata.com), public domain',
  box: BOX,
  land: land.map((coordinates) => ({ type: 'MultiPolygon', coordinates })),
  lakes: { type: 'MultiPolygon', coordinates: lakes },
  rivers: { type: 'MultiLineString', coordinates: rivers },
  streams: { type: 'MultiLineString', coordinates: streams },
};
const text = JSON.stringify(data);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${text}\n`);
console.log(
  `${land.length} countries, ${rivers.length} rivers, ${streams.length} streams, ${lakes.length} lakes`,
);
console.log(`${out}: ${Math.round(text.length / 1024)} kB`);

// --- A picture of it, to look at ---
if (look) {
  const width = 1400;
  const k = width / (E - W);
  const cos = Math.cos((((S + N) / 2) * Math.PI) / 180);
  const height = Math.round(((N - S) * k) / cos);
  const xy = ([x, y]) => `${((x - W) * k).toFixed(1)},${(((N - y) * k) / cos).toFixed(1)}`;
  const d = (points, close) => `M${points.map(xy).join(' L')}${close ? 'Z' : ''}`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="#cfe6f2"/>`,
    ...land.map(
      (polys) =>
        `<path d="${polys
          .flat()
          .map((r) => d(r, true))
          .join(' ')}" fill="#f3ecd6" fill-rule="evenodd" stroke="#8f8264" stroke-width="2"/>`,
    ),
    ...streams.map((l) => `<path d="${d(l)}" fill="none" stroke="#7fb6d8" stroke-width="1.3"/>`),
    ...rivers.map((l) => `<path d="${d(l)}" fill="none" stroke="#4f9bc9" stroke-width="3"/>`),
    ...lakes.map((p) => `<path d="${d(p[0], true)}" fill="#cfe6f2" stroke="#4f9bc9"/>`),
    '</svg>',
  ];
  fs.writeFileSync(look, svg.join('\n'));
  console.log(look);
}
