import { describe, expect, it } from 'vitest';
import { measureTrack, parseGpx, placeCheckpoints } from '../../src/futokor/gpx.js';

// Futókör: a course's track from a GPX file (see futokor/gpx.js).

// A square of about 111 m sides around (47, 19): out east, north, back
// west, and south to the start. (0.001° of latitude is ~111 m; of
// longitude at 47° north ~76 m.)
const pt = (lat, lng, ele) =>
  `<trkpt lat="${lat}" lon="${lng}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;
const GPX = `<?xml version="1.0"?>
<gpx><trk><name>teszt</name><trkseg>
  ${pt(47.0, 19.0, 100)}
  ${pt(47.0, 19.001, 101)}
  ${pt(47.001, 19.001, 110)}
</trkseg><trkseg>
  ${pt(47.001, 19.0, 104)}
  <trkpt lat="47.0" lon="19.0"/>
</trkseg></trk></gpx>`;

describe('futókör: a GPX track', () => {
  it('reads every point of every segment, with or without a height', () => {
    const points = parseGpx(GPX);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ lat: 47, lng: 19, ele: 100 });
    expect(points[4]).toEqual({ lat: 47, lng: 19, ele: null });
    expect(parseGpx('not a gpx')).toEqual([]);
  });

  it('measures the length and the climb, small bumps left out', () => {
    const measured = measureTrack(parseGpx(GPX));
    // 76 + 111 + 76 + 111 m.
    expect(measured.distanceM).toBeGreaterThan(370);
    expect(measured.distanceM).toBeLessThan(378);
    // 100 → 101 is noise; 100 → 110 a climb of 10; 110 → 104 a descent of 6.
    expect(measured).toMatchObject({ elevationGainM: 10, elevationLossM: 6 });
    expect(measureTrack([])).toEqual({ distanceM: 0, elevationGainM: 0, elevationLossM: 0 });
  });

  it('puts the checkpoints on the track, in the order they are passed', () => {
    const points = parseGpx(GPX);
    const [first, second] = placeCheckpoints(points, [
      // A few metres south of the middle of the first side...
      { lat: 46.99995, lng: 19.0005 },
      // ...and the far corner.
      { lat: 47.001, lng: 19.001 },
    ]);
    expect(first.distanceAlongM).toBeGreaterThan(35);
    expect(first.distanceAlongM).toBeLessThan(41);
    expect(first.offTrackM).toBeLessThan(8);
    expect(second.distanceAlongM).toBeGreaterThan(183);
    expect(second.distanceAlongM).toBeLessThan(191);
  });

  it('a place the loop passes twice: the second checkpoint there is the second pass', () => {
    // Out and back along one line: 47.0 → 47.002 → 47.0.
    const points = [
      { lat: 47.0, lng: 19.0 },
      { lat: 47.002, lng: 19.0 },
      { lat: 47.0, lng: 19.0 },
    ];
    const spot = { lat: 47.001, lng: 19.0 };
    const [out, back] = placeCheckpoints(points, [spot, spot]);
    expect(out.distanceAlongM).toBeGreaterThan(105);
    expect(out.distanceAlongM).toBeLessThan(117);
    expect(back.distanceAlongM).toBeGreaterThan(328);
    expect(back.distanceAlongM).toBeLessThan(340);
    // A third one there has nowhere left to go.
    expect(placeCheckpoints(points, [spot, spot, spot])[2].distanceAlongM).toBeNull();
  });
});
