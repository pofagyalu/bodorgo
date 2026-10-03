// A song's tempo: beats a minute - given in the editor (typed, or tapped
// there), shown after the song's key, blinked by the song page's metronome.

export const TEMPO_MIN = 30;
export const TEMPO_MAX = 300;

// A pause this long between two taps starts the count again.
const TAP_PAUSE = 2000;
// The tempo is the average of this many last gaps - so it settles as the
// tapping goes on, and still follows a change of mind.
const TAP_GAPS = 8;

// What is typed as a tempo: a whole number within the bounds - null for
// anything else (the empty field too).
export function readTempo(typed: string): number | null {
  const value = Number(typed.trim());
  if (!typed.trim() || !Number.isInteger(value)) return null;
  return value >= TEMPO_MIN && value <= TEMPO_MAX ? value : null;
}

// Counts a tempo from taps on a button: tap() takes the moment of a tap
// (ms) and gives the tempo so far - null at the first tap, and after a
// pause, when the count starts again.
export class TapTempo {
  private taps: number[] = [];

  tap(now: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > TAP_PAUSE) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > TAP_GAPS + 1) this.taps.shift();
    if (this.taps.length < 2) return null;
    const gap = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    return Math.min(Math.max(Math.round(60000 / gap), TEMPO_MIN), TEMPO_MAX);
  }

  reset() {
    this.taps = [];
  }
}

// How many beats the metronome gives before it stops by itself: enough to
// pick the tempo up before the song, not a click track for all of it.
export const METRONOME_BEATS = 16;

// The metronome: `beat` is called at each beat (with its number from 0).
// It stops by itself after METRONOME_BEATS (`done` is called then), or
// when told to. Seen only - it has no sound.
export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null;

  get running() {
    return this.timer !== null;
  }

  start(tempo: number, beat: (n: number) => void, done: () => void) {
    this.stop();
    let n = 0;
    const tick = () => {
      if (n >= METRONOME_BEATS) {
        this.stop();
        done();
        return;
      }
      beat(n);
      n += 1;
    };
    tick();
    this.timer = setInterval(tick, 60000 / tempo);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
