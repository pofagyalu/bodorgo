// A hike's map as the beszámoló draws it (src/utils/trackMap.js), to look
// at: the track of a GPX file on OpenStreetMap, saved as a JPEG. Fetches
// the map's tiles from OpenStreetMap. Without a GPX file: a made-up walk
// around Kékes.
//   node scripts/trackMapSample.mjs [track.gpx] [out.jpg]
import fs from 'fs';
import { measureTrack, parseGpx } from '../src/futokor/gpx.js';
import { renderTrackMap } from '../src/utils/trackMap.js';

const args = process.argv.slice(2);
const input = args.find((a) => /\.gpx$/i.test(a));
const output = args.find((a) => /\.jpe?g$/i.test(a)) ?? 'track-map-sample.jpg';

// A wobbly loop of about 9 km from Mátraháza up to Kékes and back.
const madeUp = () =>
  Array.from({ length: 400 }, (_, i) => {
    const t = (i / 399) * Math.PI * 2;
    const wobble = 1 + 0.18 * Math.sin(t * 5) + 0.08 * Math.cos(t * 11);
    return {
      lat: 47.868 + 0.011 * Math.sin(t) * wobble,
      lng: 19.992 + 0.019 * (1 - Math.cos(t)) * wobble,
      ele: 715 + 300 * Math.sin(t / 2) ** 2,
      time: Date.UTC(2026, 6, 11, 7, 12) + i * 44000,
    };
  });

const points = input ? parseGpx(fs.readFileSync(input, 'utf8')) : madeUp();
console.log(`${points.length} points`, measureTrack(points));
fs.writeFileSync(output, await renderTrackMap(points));
console.log(`✓ ${output}`);
