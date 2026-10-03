import { describe, expect, it } from 'vitest';
import {
  FUNNY,
  FinishFacts,
  GAVE_UP,
  SERIOUS,
  finishMessage,
  giveUpMessage,
} from './finish-messages';

// Always the first text, and the first of whatever fits.
const first = () => 0;
const NOON = new Date(2026, 9, 3, 12, 0).getTime();

// A 1 km lap in 6:00 at noon, the phone knowing everything, nothing special.
const facts = (over: Partial<FinishFacts> = {}): FinishFacts => ({
  totalMs: 360_000,
  paceSecPerKm: 360,
  startedAt: NOON,
  myEarlier: [350_000],
  runsToday: 1,
  records: [300_000, 350_000],
  online: true,
  cameBack: false,
  ...over,
});

describe('finishMessage: where the time puts the runner', () => {
  it('a new course record - also for the very first finisher', () => {
    expect(finishMessage(facts({ totalMs: 290_000 }), first)).toEqual({
      text: SERIOUS.record[0],
      kind: 'record',
    });
    expect(finishMessage(facts({ myEarlier: [], records: [] }), first)?.kind).toBe('record');
  });

  it('beating my own record is a record too: my old time is not someone else’s', () => {
    const mine = facts({ totalMs: 295_000, myEarlier: [300_000], records: [300_000, 350_000] });
    expect(finishMessage(mine, first)?.kind).toBe('record');
  });

  it('without a connection it only may be a record', () => {
    expect(finishMessage(facts({ totalMs: 290_000, online: false }), first)?.text).toBe(
      SERIOUS.maybeRecord[0],
    );
  });

  it('a personal best says by how much', () => {
    const better = finishMessage(facts({ totalMs: 327_000 }), first);
    expect(better).toEqual({
      text: 'Egyéni csúcs! 0:23-mal jobb, mint az eddigi legjobbad.',
      kind: 'best',
    });
    // Even when the phone has no idea of the others' times.
    expect(finishMessage(facts({ totalMs: 327_000, records: null }), first)?.kind).toBe('best');
  });

  it('a first finish: on the podium, or just the first', () => {
    const debut = facts({ myEarlier: [], records: [300_000, 400_000, 500_000] });
    expect(finishMessage(debut, first)?.text).toBe('Dobogós idő – jelenleg a 2. helyen állsz.');
    const late = facts({ myEarlier: [], records: [300_000, 310_000, 320_000] });
    expect(finishMessage(late, first)?.text).toBe(SERIOUS.firstFinish[0]);
  });

  it('claims nothing it cannot know', () => {
    // My earlier runs aren't known: no record, no best, no "first".
    expect(
      finishMessage(facts({ totalMs: 100_000, myEarlier: null, runsToday: null }), first),
    ).toBeNull();
  });
});

describe('finishMessage: something to smile at', () => {
  // Slower than my best by a little, so nothing serious applies.
  const plain = (over: Partial<FinishFacts>) =>
    finishMessage(facts({ totalMs: 400_000, myEarlier: [395_900], ...over }), first)?.text;

  it('by the pace', () => {
    expect(plain({ paceSecPerKm: 16 * 60 })).toBe(FUNNY.verySlow[0]);
    expect(plain({ paceSecPerKm: 13 * 60 })).toBe(FUNNY.slow[0]);
    expect(plain({ paceSecPerKm: 10 * 60 })).toBe(FUNNY.jog[0]);
    expect(plain({ paceSecPerKm: 3 * 60 + 50 })).toBe(FUNNY.fast[0]);
  });

  it('by how it compares with my best', () => {
    expect(plain({})).toBe(FUNNY.nearMiss[0]);
    expect(plain({ myEarlier: [200_000] })).toBe(FUNNY.muchSlower[0]);
  });

  it('by the day and the hour', () => {
    const far = { myEarlier: [380_000] };
    expect(plain({ ...far, runsToday: 3 })).toBe('Ma már a 3. köröd – nincs egyéb dolgod?');
    expect(plain({ ...far, startedAt: new Date(2026, 9, 3, 5, 30).getTime() })).toBe(
      FUNNY.early[0],
    );
    expect(plain({ ...far, startedAt: new Date(2026, 9, 3, 22, 0).getTime() })).toBe(FUNNY.late[0]);
    expect(plain({ ...far, cameBack: true })).toBe(FUNNY.cameBack[0]);
  });

  it('nothing to say is fine too', () => {
    expect(plain({ myEarlier: [380_000] })).toBeUndefined();
  });

  it('picks among the texts and among what fits', () => {
    const last = () => 0.99;
    expect(
      finishMessage(
        facts({ totalMs: 400_000, myEarlier: [380_000], paceSecPerKm: 16 * 60, runsToday: 4 }),
        last,
      )?.text,
    ).toBe('Ma már a 4. köröd – nincs egyéb dolgod?');
    expect(giveUpMessage(last)).toBe(GAVE_UP.at(-1));
  });
});
