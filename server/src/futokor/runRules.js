// Futókör (the checkpoint running race): the rules of a run.
//
// A course is a loop: one card is both START and FINISH, the others are
// checkpoints to pass in order. A runner scans (QR) or touches (NFC) each
// card; everything a run is - started, which checkpoints are passed, the
// splits, finished - follows from those scans, in the order of their time.
//
// This file is pure: no database, no clock, nothing imported. The phone
// has to decide the same things on its own (the garden may have no signal -
// scans are uploaded later, on Wi-Fi), so the same rules must run there;
// the server replays every runner's scans with them (replayScans) and its
// result is the official one.
//
// A course, as the rules need it:
//   { checkpoints: [{ id, tagId, kind: 'startFinish' | 'checkpoint', label,
//       order, distanceAlongM?, lat?, lng? }],   // order: 1, 2, 3... (START/FINISH: 0)
//     distanceM?,                                 // the whole loop
//     flagSpeedMps?, duplicateScanWindowSec?, maxRunDurationMin? }
// A scan: { clientScanId, tagId, time (ms), lat?, lng?, accuracyM?,
//   action?: 'restart' | 'giveUp' }
// A run: { status: 'running' | 'finished' | 'gave_up' | 'abandoned' | 'expired',
//   startedAt, scans: [...accepted ones], passed, splits, flagged,
//   finishedAt?, endedAt?, totalMs?, paceSecPerKm? }

// Nobody runs faster than the 100 m world record (9.58 s): a scan that
// would mean so is refused.
export const MAX_SPEED_MPS = 10.4;

export const DEFAULTS = {
  // Faster than this between two cards (3:00 min/km) is accepted, but the
  // run is flagged for an admin to look at.
  flagSpeedMps: 5.5,
  // The same card again this soon is the same scan (it didn't seem to
  // register; a QR scan and then an NFC touch).
  duplicateScanWindowSec: 30,
  maxRunDurationMin: 60,
};
// How far from the card a scan's own position may be (plus its accuracy)
// before it's flagged.
const GPS_TOLERANCE_M = 30;

const settings = (course) => ({
  flagSpeedMps: course.flagSpeedMps ?? DEFAULTS.flagSpeedMps,
  duplicateMs: (course.duplicateScanWindowSec ?? DEFAULTS.duplicateScanWindowSec) * 1000,
  maxRunMs: (course.maxRunDurationMin ?? DEFAULTS.maxRunDurationMin) * 60 * 1000,
});

// The checkpoints to pass, in order - without the START/FINISH card.
const stops = (course) =>
  course.checkpoints.filter((c) => c.kind === 'checkpoint').sort((a, b) => a.order - b.order);

const isOpen = (run) => run?.status === 'running';

// Metres between two positions (haversine).
function metresBetween(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// A scan made noticeably away from its card - worth an admin's look, never
// a reason to stop the runner.
const farFromCard = (checkpoint, scan) =>
  [checkpoint.lat, checkpoint.lng, scan.lat, scan.lng].every((v) => typeof v === 'number') &&
  metresBetween(checkpoint, scan) > GPS_TOLERANCE_M + (scan.accuracyM ?? 0);

// The checkpoint an open run has to pass next - null once all are passed
// (then it's the FINISH).
export function nextCheckpoint(course, run) {
  return isOpen(run) ? (stops(course)[run.passed] ?? null) : null;
}

// An open run that has been going for longer than the course allows.
export function isExpired(course, run, time) {
  return isOpen(run) && time - run.startedAt > settings(course).maxRunMs;
}

// The stretch from the run's last card to this one: its time, and - if the
// course has been measured - its length, pace and speed.
function splitTo(run, fromId, to, distanceAlongM, time) {
  const last = run.scans.at(-1);
  const ms = time - last.time;
  const measured = typeof distanceAlongM === 'number' && typeof last.distanceAlongM === 'number';
  const distanceM = measured ? distanceAlongM - last.distanceAlongM : null;
  const speedMps = measured && ms > 0 ? distanceM / (ms / 1000) : null;
  return {
    fromCheckpointId: fromId,
    toCheckpointId: to.id,
    ms,
    distanceM,
    speedMps,
    paceSecPerKm: speedMps ? Math.round(1000 / speedMps) : null,
  };
}

// One scan, for a runner whose latest run is `run` (null: none yet).
// Answers { run, closed, outcome }:
// - `run`: their latest run after the scan (the same object if nothing
//   changed);
// - `closed`: the run this scan ended on the way to a new one - one that
//   had expired, or was given up for a restart - or null;
// - `outcome.result`:
//     'started' | 'passed' | 'finished' | 'gaveUp'   - it counted
//     'duplicate'       - the same card again: ignored
//     'incomplete'      - START/FINISH with checkpoints still missing
//                         (`outcome.missing`: the next one): the runner
//                         chooses - go on, or scan again with
//                         action 'restart'
//     'rejectedOrder'   - a checkpoint ahead of the next one (`missing`)
//     'rejectedSpeed'   - faster than anyone can run (`speedMps`)
//     'noRun'           - a checkpoint without a run started
//     'unknownTag'      - a card that isn't on this course
export function applyScan(course, run, scan) {
  const { flagSpeedMps, duplicateMs } = settings(course);
  const same = (result, extra = {}) => ({ run, closed: null, outcome: { result, ...extra } });

  if (scan.action === 'giveUp') {
    if (!isOpen(run)) return same('noRun');
    return {
      run: { ...run, status: 'gave_up', endedAt: scan.time },
      closed: null,
      outcome: { result: 'gaveUp' },
    };
  }

  const checkpoint = course.checkpoints.find((c) => c.tagId === scan.tagId);
  if (!checkpoint) return same('unknownTag');

  // A run left open for too long is over before this scan is looked at.
  let closed = null;
  let current = run;
  if (isExpired(course, run, scan.time)) {
    closed = { ...run, status: 'expired', endedAt: run.startedAt + settings(course).maxRunMs };
    current = closed;
  }
  const answer = (result, extra = {}) => ({
    run: current,
    closed,
    outcome: { result, checkpoint, ...extra },
  });

  const flags = farFromCard(checkpoint, scan) ? ['gps'] : [];
  const record = (role, distanceAlongM) => ({
    clientScanId: scan.clientScanId,
    tagId: scan.tagId,
    checkpointId: checkpoint.id,
    role,
    time: scan.time,
    distanceAlongM: distanceAlongM ?? null,
    flags,
  });
  const start = () => ({
    run: {
      status: 'running',
      startedAt: scan.time,
      scans: [record('start', 0)],
      passed: 0,
      splits: [],
      flagged: flags.length > 0,
    },
    closed,
    outcome: { result: 'started', checkpoint },
  });

  // The next card of an open run: its split, checked for speed.
  const advance = (role, distanceAlongM) => {
    const fromId = current.scans.at(-1).checkpointId;
    const split = splitTo(current, fromId, checkpoint, distanceAlongM, scan.time);
    if (split.ms <= 0 || (split.speedMps ?? 0) > MAX_SPEED_MPS) {
      return answer('rejectedSpeed', { speedMps: split.speedMps });
    }
    if ((split.speedMps ?? 0) > flagSpeedMps) flags.push('speed');
    return {
      ...current,
      scans: [...current.scans, record(role, distanceAlongM)],
      splits: [...current.splits, split],
      flagged: current.flagged || flags.length > 0,
    };
  };

  if (checkpoint.kind === 'startFinish') {
    if (!isOpen(current)) {
      // Right after a finish, the same card again is not a new start.
      if (current?.status === 'finished' && scan.time - current.finishedAt <= duplicateMs) {
        return answer('duplicate');
      }
      return start();
    }
    if (current.passed === 0 && scan.time - current.startedAt <= duplicateMs) {
      return answer('duplicate');
    }
    const missing = nextCheckpoint(course, current);
    if (missing) {
      if (scan.action !== 'restart') return answer('incomplete', { missing });
      closed = { ...current, status: 'abandoned', endedAt: scan.time };
      return start();
    }
    const finished = advance('finish', course.distanceM);
    if (finished.outcome) return finished; // refused for speed
    const totalMs = scan.time - current.startedAt;
    return {
      run: {
        ...finished,
        status: 'finished',
        finishedAt: scan.time,
        totalMs,
        paceSecPerKm: course.distanceM ? Math.round(totalMs / course.distanceM) : null,
      },
      closed,
      outcome: { result: 'finished', checkpoint, split: finished.splits.at(-1) },
    };
  }

  // A checkpoint.
  if (!isOpen(current)) return answer('noRun');
  const place = stops(course).findIndex((c) => c.id === checkpoint.id);
  if (place < current.passed) return answer('duplicate');
  if (place > current.passed) {
    return answer('rejectedOrder', { missing: nextCheckpoint(course, current) });
  }
  const passed = advance('checkpoint', checkpoint.distanceAlongM);
  if (passed.outcome) return passed; // refused for speed
  return {
    run: { ...passed, passed: current.passed + 1 },
    closed,
    outcome: { result: 'passed', checkpoint, split: passed.splits.at(-1) },
  };
}

// All of one runner's scans on a course, whenever they reached the server:
// put in the order of their time and applied one by one. Answers their
// runs (the oldest first) and, for every scan, what came of it
// ({ clientScanId, result, runIndex } - runIndex: the run it belongs to,
// null if it counted for none).
export function replayScans(course, scans) {
  const runs = [];
  const results = [];
  const ordered = scans
    .map((scan, i) => ({ scan, i }))
    .sort((a, b) => a.scan.time - b.scan.time || a.i - b.i);

  for (const { scan } of ordered) {
    const { run, closed, outcome } = applyScan(course, runs.at(-1) ?? null, scan);
    if (closed) runs[runs.length - 1] = closed;
    if (outcome.result === 'started') runs.push(run);
    else if (run && runs.length && run !== closed) runs[runs.length - 1] = run;

    const counted = ['started', 'passed', 'finished', 'gaveUp'].includes(outcome.result);
    results.push({
      clientScanId: scan.clientScanId,
      result: outcome.result,
      runIndex: counted ? runs.length - 1 : null,
    });
  }
  return { runs, results };
}
