import sharp from 'sharp';
import { fetchMapTile } from './mapTiles.js';

// A hike's map for the beszámoló (tourReportController.js): the track
// drawn on OpenStreetMap, as one JPEG. The map is put together from the
// tiles that cover the track (utils/mapTiles.js), at the closest zoom the
// whole track still fits in.

const TILE = 256;
export const TRACK_MAP_WIDTH = 1200;
export const TRACK_MAP_HEIGHT = 720;
// Kept clear around the track.
const PADDING = 70;
const MAX_ZOOM = 16;
// What must stand under a map made of their tiles.
export const MAP_CREDIT = '© OpenStreetMap közreműködők';

const TRACK_COLOR = '#d81b60';
const START_COLOR = '#2e7d32';
const END_COLOR = '#c62828';

// Web Mercator: a position in the world's pixels at a zoom.
const worldX = (lng, z) => ((lng + 180) / 360) * 2 ** z * TILE;
const worldY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z * TILE;
};

// The closest zoom the track fits in, and the picture's top-left corner in
// the world's pixels there (the track in the middle).
function frame(points) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  let z = MAX_ZOOM;
  while (
    z > 1 &&
    (worldX(east, z) - worldX(west, z) > TRACK_MAP_WIDTH - PADDING * 2 ||
      worldY(south, z) - worldY(north, z) > TRACK_MAP_HEIGHT - PADDING * 2)
  ) {
    z -= 1;
  }
  return {
    z,
    left: Math.round((worldX(west, z) + worldX(east, z)) / 2 - TRACK_MAP_WIDTH / 2),
    top: Math.round((worldY(north, z) + worldY(south, z)) / 2 - TRACK_MAP_HEIGHT / 2),
  };
}

// The track as an SVG the size of the picture: a white-edged line, a green
// dot where it starts, a red one where it ends.
function trackOverlay(points, { z, left, top }) {
  const xy = [];
  for (const p of points) {
    const at = [worldX(p.lng, z) - left, worldY(p.lat, z) - top];
    // A watch's point every second: one per pixel is plenty.
    const last = xy.at(-1);
    if (!last || Math.hypot(at[0] - last[0], at[1] - last[1]) >= 1) xy.push(at);
  }
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const dot = ([x, y], color) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${color}" stroke="#fff" stroke-width="3"/>`;
  const stroke = (color, width) =>
    `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TRACK_MAP_WIDTH}" height="${TRACK_MAP_HEIGHT}">` +
      stroke('#fff', 8) +
      stroke(TRACK_COLOR, 4.5) +
      dot(xy.at(-1), END_COLOR) +
      dot(xy[0], START_COLOR) +
      `</svg>`,
  );
}

// The map of a track ({ lat, lng } points, in order), as a JPEG buffer.
// Throws when a tile can't be had - the beszámoló then goes without the
// map (and it is tried again the next time).
export async function renderTrackMap(points) {
  if (points.length < 2) throw new Error('track map: no track');
  const view = frame(points);
  const { z, left, top } = view;
  const [firstCol, lastCol] = [
    Math.floor(left / TILE),
    Math.floor((left + TRACK_MAP_WIDTH - 1) / TILE),
  ];
  const [firstRow, lastRow] = [
    Math.floor(top / TILE),
    Math.floor((top + TRACK_MAP_HEIGHT - 1) / TILE),
  ];

  // The whole tiles side by side, then the picture cut out of them. Two at
  // a time - their policy asks for no more.
  const wanted = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) wanted.push({ row, col });
  }
  const tiles = [];
  const worker = async () => {
    for (let next = wanted.shift(); next; next = wanted.shift()) {
      const { row, col } = next;
      // Around the world sideways; no tiles above or below it.
      const x = ((col % 2 ** z) + 2 ** z) % 2 ** z;
      if (row < 0 || row >= 2 ** z) continue;
      tiles.push({
        input: await fetchMapTile(z, x, row),
        left: (col - firstCol) * TILE,
        top: (row - firstRow) * TILE,
      });
    }
  };
  await Promise.all([worker(), worker()]);

  const sheet = await sharp({
    create: {
      width: (lastCol - firstCol + 1) * TILE,
      height: (lastRow - firstRow + 1) * TILE,
      channels: 3,
      background: '#e8e6df',
    },
  })
    .composite(tiles)
    .png()
    .toBuffer();
  return sharp(sheet)
    .extract({
      left: left - firstCol * TILE,
      top: top - firstRow * TILE,
      width: TRACK_MAP_WIDTH,
      height: TRACK_MAP_HEIGHT,
    })
    .composite([{ input: trackOverlay(points, view) }])
    .jpeg({ quality: 86 })
    .toBuffer();
}
