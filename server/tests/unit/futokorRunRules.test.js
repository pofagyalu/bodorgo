import { describe, expect, it } from 'vitest';
import { applyScan, isExpired, nextCheckpoint, replayScans } from '../../src/futokor/runRules.js';

// Futókör: the rules of a run (see futokor/runRules.js).

// A 900 m loop: START/FINISH and two checkpoints, 300 m apart.
const COURSE = {
  distanceM: 900,
  maxRunDurationMin: 30,
  checkpoints: [
    { id: 'sf', tagId: 'T00', kind: 'startFinish', label: 'START', order: 0 },
    { id: 'cp1', tagId: 'T07', kind: 'checkpoint', label: 'CP1', order: 1, distanceAlongM: 300 },
    { id: 'cp2', tagId: 'T03', kind: 'checkpoint', label: 'CP2', order: 2, distanceAlongM: 600 },
  ],
};
const TAG = { start: 'T00', cp1: 'T07', cp2: 'T03' };

let scanCount = 0;
// A scan of a card, `sec` seconds after the start of the test's clock.
const scan = (card, sec, extra = {}) => ({
  clientScanId: `s${(scanCount += 1)}`,
  tagId: TAG[card] ?? card,
  time: sec * 1000,
  ...extra,
});

// Scans applied one after the other; answers the last one's answer.
const run = (...scans) =>
  scans.reduce((state, s) => applyScan(COURSE, state.run, s), { run: null });

describe('futókör: a run', () => {
  it('starts at the START card', () => {
    const { run: r, outcome } = run(scan('start', 0));
    expect(outcome.result).toBe('started');
    expect(r).toMatchObject({ status: 'running', startedAt: 0, passed: 0, flagged: false });
    expect(nextCheckpoint(COURSE, r)).toMatchObject({ label: 'CP1', tagId: 'T07' });
  });

  it('passes the checkpoints in order, with a split for each', () => {
    const { run: r, outcome } = run(scan('start', 0), scan('cp1', 100), scan('cp2', 220));
    expect(outcome.result).toBe('passed');
    expect(r.passed).toBe(2);
    // 300 m in 100 s: 3 m/s, 5:33 a kilometre; then 300 m in 120 s.
    expect(r.splits).toMatchObject([
      { fromCheckpointId: 'sf', toCheckpointId: 'cp1', ms: 100000, distanceM: 300, speedMps: 3 },
      { fromCheckpointId: 'cp1', toCheckpointId: 'cp2', ms: 120000, paceSecPerKm: 400 },
    ]);
    expect(r.splits[0].paceSecPerKm).toBe(333);
    expect(nextCheckpoint(COURSE, r)).toBeNull();
  });

  it('finishes at the same card, once every checkpoint is passed', () => {
    const { run: r, outcome } = run(
      scan('start', 0),
      scan('cp1', 100),
      scan('cp2', 200),
      scan('start', 300),
    );
    expect(outcome.result).toBe('finished');
    expect(outcome.split).toMatchObject({ toCheckpointId: 'sf', distanceM: 300 });
    // 900 m in 300 s: 5:33 a kilometre.
    expect(r).toMatchObject({ status: 'finished', totalMs: 300000, paceSecPerKm: 333 });
    expect(r.scans.map((s) => s.role)).toEqual(['start', 'checkpoint', 'checkpoint', 'finish']);
  });

  it('refuses a checkpoint out of order, and one without a run', () => {
    const ahead = run(scan('start', 0), scan('cp2', 200));
    expect(ahead.outcome).toMatchObject({ result: 'rejectedOrder', missing: { label: 'CP1' } });
    expect(ahead.run.passed).toBe(0);

    expect(run(scan('cp1', 10)).outcome.result).toBe('noRun');
    expect(run(scan('T99', 10)).outcome.result).toBe('unknownTag');
  });

  it('ignores the same card again', () => {
    // START again right away; a checkpoint again, any time later.
    expect(run(scan('start', 0), scan('start', 20)).outcome.result).toBe('duplicate');
    const again = run(scan('start', 0), scan('cp1', 100), scan('cp1', 500));
    expect(again.outcome.result).toBe('duplicate');
    expect(again.run.passed).toBe(1);

    // FINISH again right after finishing is not a new start...
    const finished = [scan('start', 0), scan('cp1', 100), scan('cp2', 200), scan('start', 300)];
    expect(run(...finished, scan('start', 310)).outcome.result).toBe('duplicate');
    // ...but later it is: another run.
    const next = run(...finished, scan('start', 400));
    expect(next.outcome.result).toBe('started');
    expect(next.run.startedAt).toBe(400000);
  });

  it('START with checkpoints missing: go on, or restart', () => {
    const open = [scan('start', 0), scan('cp1', 100)];
    const asked = run(...open, scan('start', 200));
    expect(asked.outcome).toMatchObject({ result: 'incomplete', missing: { label: 'CP2' } });
    expect(asked.run).toMatchObject({ status: 'running', passed: 1 });

    const restarted = run(...open, scan('start', 200, { action: 'restart' }));
    expect(restarted.outcome.result).toBe('started');
    expect(restarted.closed).toMatchObject({ status: 'abandoned', endedAt: 200000 });
    expect(restarted.run).toMatchObject({ status: 'running', startedAt: 200000, passed: 0 });
  });

  it('refuses an impossible speed, flags a suspicious one', () => {
    // 300 m in 20 s is 15 m/s: nobody runs that.
    const tooFast = run(scan('start', 0), scan('cp1', 20));
    expect(tooFast.outcome).toMatchObject({ result: 'rejectedSpeed', speedMps: 15 });
    expect(tooFast.run.passed).toBe(0);
    // The same card a little later is fine.
    expect(run(scan('start', 0), scan('cp1', 20), scan('cp1', 100)).outcome.result).toBe('passed');

    // 300 m in 50 s is 6 m/s: possible, but worth a look.
    const quick = run(scan('start', 0), scan('cp1', 50));
    expect(quick.outcome.result).toBe('passed');
    expect(quick.run.flagged).toBe(true);
    expect(quick.run.scans.at(-1).flags).toEqual(['speed']);
    // A phone's clock running backwards is refused too.
    expect(run(scan('start', 100), scan('cp1', 50)).outcome.result).toBe('rejectedSpeed');
  });

  it('flags a scan made far from its card - without stopping the runner', () => {
    const course = {
      ...COURSE,
      checkpoints: COURSE.checkpoints.map((c) =>
        c.id === 'cp1' ? { ...c, lat: 47.0, lng: 19.0 } : c,
      ),
    };
    const from = applyScan(course, null, scan('start', 0)).run;
    // About 111 m north of the card; then right at it, with poor accuracy.
    const far = applyScan(
      course,
      from,
      scan('cp1', 100, { lat: 47.001, lng: 19.0, accuracyM: 10 }),
    );
    expect(far.outcome.result).toBe('passed');
    expect(far.run.scans.at(-1).flags).toEqual(['gps']);
    const near = applyScan(course, from, scan('cp1', 100, { lat: 47.0002, lng: 19.0 }));
    expect(near.run.flagged).toBe(false);
  });

  it('a run left open too long has expired; the next START is a new one', () => {
    const open = run(scan('start', 0), scan('cp1', 100)).run;
    expect(isExpired(COURSE, open, 29 * 60 * 1000)).toBe(false);
    expect(isExpired(COURSE, open, 31 * 60 * 1000)).toBe(true);

    const late = applyScan(COURSE, open, scan('cp2', 40 * 60));
    expect(late.outcome.result).toBe('noRun');
    expect(late.closed).toMatchObject({ status: 'expired', endedAt: 30 * 60 * 1000 });

    const again = applyScan(COURSE, open, scan('start', 40 * 60));
    expect(again.outcome.result).toBe('started');
    expect(again.closed.status).toBe('expired');
  });

  it('can be given up', () => {
    const { run: r, outcome } = run(scan('start', 0), scan(null, 150, { action: 'giveUp' }));
    expect(outcome.result).toBe('gaveUp');
    expect(r).toMatchObject({ status: 'gave_up', endedAt: 150000 });
    expect(applyScan(COURSE, r, scan('cp1', 200)).outcome.result).toBe('noRun');
    expect(applyScan(COURSE, null, scan(null, 5, { action: 'giveUp' })).outcome.result).toBe(
      'noRun',
    );
  });

  it('works on a course not measured yet: times, but no pace and no speed check', () => {
    const course = {
      checkpoints: COURSE.checkpoints.map(({ distanceAlongM, ...c }) => c),
    };
    const steps = [scan('start', 0), scan('cp1', 5), scan('cp2', 10), scan('start', 15)];
    const end = steps.reduce((state, s) => applyScan(course, state.run, s), { run: null });
    expect(end.outcome.result).toBe('finished');
    expect(end.run).toMatchObject({ totalMs: 15000, paceSecPerKm: null, flagged: false });
    expect(end.run.splits[0]).toMatchObject({ ms: 5000, distanceM: null, paceSecPerKm: null });
  });
});

describe('futókör: all of a runner’s scans, replayed', () => {
  it('puts them in the order of their time, however they arrived', () => {
    const first = [scan('start', 0), scan('cp1', 100), scan('cp2', 200), scan('start', 300)];
    const second = [scan('start', 1000), scan('cp1', 1100), scan(null, 1150, { action: 'giveUp' })];
    // The second run's scans reach the server first, the rest jumbled.
    const arrived = [...second, first[2], first[0], first[3], first[1]];

    const { runs, results } = replayScans(COURSE, arrived);
    expect(runs.map((r) => r.status)).toEqual(['finished', 'gave_up']);
    expect(runs[0].totalMs).toBe(300000);
    expect(runs[1].passed).toBe(1);

    const of = (s) => results.find((r) => r.clientScanId === s.clientScanId);
    expect(of(first[0])).toMatchObject({ result: 'started', runIndex: 0 });
    expect(of(first[3])).toMatchObject({ result: 'finished', runIndex: 0 });
    expect(of(second[2])).toMatchObject({ result: 'gaveUp', runIndex: 1 });
    expect(results).toHaveLength(7);
  });

  it('keeps the runs a restart or an expiry closed', () => {
    const { runs, results } = replayScans(COURSE, [
      scan('start', 0),
      scan('cp1', 100),
      scan('start', 200, { action: 'restart' }),
      scan('cp1', 300),
      // Forgotten open; back the next morning.
      scan('start', 50000),
      scan('cp2', 50100),
    ]);
    expect(runs.map((r) => r.status)).toEqual(['abandoned', 'expired', 'running']);
    expect(results.at(-1)).toMatchObject({ result: 'rejectedOrder', runIndex: null });
  });

  it('nothing in, nothing out', () => {
    expect(replayScans(COURSE, [])).toEqual({ runs: [], results: [] });
  });
});
