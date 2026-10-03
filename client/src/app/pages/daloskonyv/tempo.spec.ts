import { METRONOME_BEATS, Metronome, TapTempo, readTempo } from './tempo';

describe('readTempo', () => {
  it('takes a whole number within the bounds', () => {
    expect(readTempo('96')).toBe(96);
    expect(readTempo(' 120 ')).toBe(120);
    expect(readTempo('30')).toBe(30);
    expect(readTempo('300')).toBe(300);
  });

  it('gives null for anything else', () => {
    for (const typed of ['', ' ', '29', '301', '96.5', 'gyors']) {
      expect(readTempo(typed)).toBeNull();
    }
  });
});

describe('TapTempo', () => {
  it('counts the tempo from the second tap on', () => {
    const taps = new TapTempo();
    expect(taps.tap(1000)).toBeNull();
    // Half a second apart: 120 a minute.
    expect(taps.tap(1500)).toBe(120);
    expect(taps.tap(2000)).toBe(120);
  });

  it('averages the gaps, so an uneven tap evens out', () => {
    const taps = new TapTempo();
    taps.tap(0);
    taps.tap(480);
    taps.tap(1020);
    expect(taps.tap(1500)).toBe(120);
  });

  it('follows the last taps when the tapping changes', () => {
    const taps = new TapTempo();
    let now = 0;
    taps.tap(now);
    for (let i = 0; i < 4; i += 1) taps.tap((now += 500));
    let tempo: number | null = null;
    // A second apart from here: after enough taps only these count.
    for (let i = 0; i < 9; i += 1) tempo = taps.tap((now += 1000));
    expect(tempo).toBe(60);
  });

  it('starts again after a pause, and stays within the bounds', () => {
    const taps = new TapTempo();
    taps.tap(0);
    taps.tap(500);
    expect(taps.tap(5000)).toBeNull();
    // Faster than any song: the upper bound.
    expect(taps.tap(5050)).toBe(300);
    taps.reset();
    expect(taps.tap(6000)).toBeNull();
  });
});

describe('Metronome', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('beats at the tempo, and stops by itself', () => {
    const metronome = new Metronome();
    const beats: number[] = [];
    const done = vi.fn();
    metronome.start(120, (n) => beats.push(n), done);
    // The first beat at once, then one every half second.
    expect(beats).toEqual([0]);
    vi.advanceTimersByTime(1000);
    expect(beats).toEqual([0, 1, 2]);
    expect(metronome.running).toBe(true);

    vi.advanceTimersByTime(500 * METRONOME_BEATS);
    expect(beats.length).toBe(METRONOME_BEATS);
    expect(done).toHaveBeenCalledTimes(1);
    expect(metronome.running).toBe(false);
  });

  it('stops when told to', () => {
    const metronome = new Metronome();
    const beat = vi.fn();
    const done = vi.fn();
    metronome.start(60, beat, done);
    metronome.stop();
    vi.advanceTimersByTime(30000);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    expect(metronome.running).toBe(false);
  });
});
