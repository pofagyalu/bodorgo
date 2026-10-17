// Futókör: a course's track from a GPX file (a watch's recording, or a
// route planned in Garmin Connect) - its points, its length, its climb,
// and where the checkpoints are along it. Pure: no database, no files.

// Metres between two positions (haversine).
export function metresBetween(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// Changes of height under this are taken as noise, not as climbing.
const CLIMB_STEP_M = 3;
// Two passes of the same place: the first one this close to the nearest
// one wins (a checkpoint belongs to the first time the loop gets there).
const SAME_PLACE_M = 10;

// A stored track keeps a point only this far from the last one kept: a
// watch records one every second, far more than drawing the loop needs.
const KEEP_EVERY_M = 3;

// Each <trkpt> of a GPX text: its attributes and what is inside it ('' for
// a <trkpt ... />). Read forward once, never back - a file of points
// without their </trkpt> (anyone may upload one) made a single regex over
// the whole text search to its end again for every point, minutes of a
// frozen server for a few MB. A point left open ends the reading: the
// rest of that file is broken anyway.
function* trackPointTags(text) {
  let at = 0;
  for (;;) {
    const start = text.indexOf('<trkpt', at);
    if (start < 0) return;
    at = start + '<trkpt'.length;
    if (/\w/.test(text[at] ?? '')) continue; // <trkptx>: another tag
    const tagEnd = text.indexOf('>', at);
    if (tagEnd < 0) return;
    if (text[tagEnd - 1] === '/') {
      yield { attrs: text.slice(at, tagEnd - 1), body: '' };
      at = tagEnd + 1;
      continue;
    }
    const close = text.indexOf('</trkpt>', tagEnd);
    if (close < 0) return;
    yield { attrs: text.slice(at, tagEnd), body: text.slice(tagEnd + 1, close) };
    at = close + '</trkpt>'.length;
  }
}

// Every track point of a GPX text, in order (all its segments one after
// the other): { lat, lng, ele, time (ms) } - ele and time null if the
// point has none (a planned route has no times).
export function parseGpx(gpx) {
  return [...trackPointTags(String(gpx))]
    .map(({ attrs, body }) => {
      const ele = /<ele>([^<]+)<\/ele>/.exec(body);
      const time = Date.parse(/<time>([^<]+)<\/time>/.exec(body)?.[1] ?? '');
      return {
        lat: Number(/\blat="([^"]+)"/.exec(attrs)?.[1]),
        lng: Number(/\blon="([^"]+)"/.exec(attrs)?.[1]),
        ele: ele ? Number(ele[1]) : null,
        time: Number.isNaN(time) ? null : time,
      };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

// The track's name, as the file gives it - '' if it has none.
export const gpxName = (gpx) => /<name>([^<]*)<\/name>/.exec(String(gpx))?.[1]?.trim() ?? '';

// A lighter track of the same shape: the first and the last point, and of
// the ones between only those at least KEEP_EVERY_M from the last kept.
export function thinTrack(points) {
  const kept = [];
  for (const [i, p] of points.entries()) {
    if (i === 0 || i === points.length - 1 || metresBetween(kept.at(-1), p) >= KEEP_EVERY_M) {
      kept.push(p);
    }
  }
  return kept;
}

// The track measured: its length, what it climbs and descends - and, if it
// was recorded (its points have times), when it started and how long it
// took from the first point to the last.
export function measureTrack(points) {
  let distanceM = 0;
  for (let i = 1; i < points.length; i += 1) distanceM += metresBetween(points[i - 1], points[i]);

  let [gain, loss] = [0, 0];
  let ref = points.find((p) => p.ele !== null)?.ele ?? null;
  for (const p of points) {
    if (p.ele === null || ref === null) continue;
    const d = p.ele - ref;
    if (Math.abs(d) >= CLIMB_STEP_M) {
      if (d > 0) gain += d;
      else loss -= d;
      ref = p.ele;
    }
  }
  const times = points.map((p) => p.time).filter((t) => t != null);
  return {
    distanceM: Math.round(distanceM),
    elevationGainM: Math.round(gain),
    elevationLossM: Math.round(loss),
    startedAt: times.length ? new Date(times[0]) : null,
    durationSec: times.length > 1 ? Math.round((times.at(-1) - times[0]) / 1000) : null,
  };
}

// The nearest spot of one stretch (a → b, starting `from` metres along the
// track) to a position: how far along the track it is, and how far off it.
// (Flat-earth arithmetic - fine at the size of a garden or a village.)
function onto(a, b, from, length, p) {
  const k = Math.cos((a.lat * Math.PI) / 180);
  const [ax, ay, bx, by, px, py] = [a.lng * k, a.lat, b.lng * k, b.lat, p.lng * k, p.lat];
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2
    ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2))
    : 0;
  const spot = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { along: from + length * t, off: metresBetween(spot, p) };
}

// Where each checkpoint ({ lat, lng }, in the order they're passed) is
// along the track: put onto its nearest spot - looking only after the
// previous checkpoint, so a loop that passes a place twice gets them in the
// right order. Answers, for each: { distanceAlongM, offTrackM }.
export function placeCheckpoints(points, checkpoints) {
  let from = 0;
  const legs = points.slice(1).map((b, i) => {
    const length = metresBetween(points[i], b);
    const leg = { a: points[i], b, from, length };
    from += length;
    return leg;
  });

  let after = 0;
  return checkpoints.map((p) => {
    const hits = legs
      .map((leg) => onto(leg.a, leg.b, leg.from, leg.length, p))
      .filter((h) => h.along > after + 1);
    if (!hits.length) return { distanceAlongM: null, offTrackM: null };
    const nearest = Math.min(...hits.map((h) => h.off));
    const hit = hits.find((h) => h.off <= nearest + SAME_PLACE_M);
    after = hit.along;
    return { distanceAlongM: Math.round(hit.along), offTrackM: Math.round(hit.off) };
  });
}
