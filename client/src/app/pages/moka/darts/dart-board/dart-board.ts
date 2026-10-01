import { Component, computed, input, output } from '@angular/core';
import { DartThrow } from '../../../../services/darts';

// The numbers clockwise from the top, as on a real board.
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// The rings' radii in the 450-wide drawing. Not a real board's proportions:
// the double and triple rings and the bulls are a good deal wider, so a
// finger can hit them on a phone (the board is also the way to enter a
// dart - see `tapped`).
const R = { bull: 13, outerBull: 30, tripleIn: 88, tripleOut: 114, doubleIn: 146, doubleOut: 172 };
const NUMBER_R = 196;

// A point on the board: the angle in degrees, clockwise from the top.
const xy = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
};
const point = (r: number, deg: number) => {
  const { x, y } = xy(r, deg);
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
};

// One number's slice of a ring, between two radii.
const wedge = (rIn: number, rOut: number, from: number, to: number) =>
  `M${point(rOut, from)} A${rOut} ${rOut} 0 0 1 ${point(rOut, to)} ` +
  `L${point(rIn, to)} A${rIn} ${rIn} 0 0 0 ${point(rIn, from)} Z`;

// The ring a dart of this multiplier lands in: its inner and outer radius.
// (A single is shown in the big outer single field.)
const ringOf = (multiplier: number): [number, number] =>
  multiplier === 3
    ? [R.tripleIn, R.tripleOut]
    : multiplier === 2
      ? [R.doubleIn, R.doubleOut]
      : [R.tripleOut, R.doubleIn];

// A dartboard in a real one's colors: every number's single, double
// and triple fields, the two bulls and the numbers around. It builds up
// slice by slice when it appears. A game shows the turn's darts on it
// (`darts`), lights up the field to aim at (`target`), and - when
// `interactive` - takes a dart by a tap on the field it landed in
// (`tapped`; the edge around the fields is a miss).
@Component({
  selector: 'app-dart-board',
  templateUrl: './dart-board.html',
  styleUrl: './dart-board.scss',
})
export class DartBoard {
  darts = input<DartThrow[]>([]);
  target = input<DartThrow | null>(null);
  interactive = input(false);
  tapped = output<DartThrow>();

  readonly r = R;

  readonly sectors = SECTORS.map((value, i) => {
    const [from, to] = [i * 18 - 9, i * 18 + 9];
    const [x, y] = point(NUMBER_R, i * 18).split(' ');
    return {
      value,
      // The two looks alternate around the board.
      even: i % 2 === 0,
      delay: `${i * 35}ms`,
      innerSingle: wedge(R.outerBull, R.tripleIn, from, to),
      triple: wedge(R.tripleIn, R.tripleOut, from, to),
      outerSingle: wedge(R.tripleOut, R.doubleIn, from, to),
      double: wedge(R.doubleIn, R.doubleOut, from, to),
      x,
      y,
    };
  });

  // Where each dart sits: in the middle of its field, the turn's darts a
  // little apart so two in the same field both show; a miss off the board,
  // at the bottom of the rim.
  markers = computed(() =>
    this.darts().map((t, k) => {
      const spread = k - 1; // -1, 0, 1 for the three darts
      if (t.segment === 0) return { ...xy(210, 180 + spread * 9), miss: true };
      if (t.segment === 25) {
        const r = t.multiplier === 2 ? 5 : (R.bull + R.outerBull) / 2;
        return { ...xy(r, k * 120), miss: false };
      }
      const [rIn, rOut] = ringOf(t.multiplier);
      return {
        ...xy((rIn + rOut) / 2, SECTORS.indexOf(t.segment) * 18 + spread * 4.5),
        miss: false,
      };
    }),
  );

  // The field to aim at, drawn again on top: a ring's slice, or a bull.
  targetShape = computed(() => {
    const t = this.target();
    if (!t || t.segment === 0) return null;
    if (t.segment === 25) return { bullR: t.multiplier === 2 ? R.bull : R.outerBull, d: null };
    const at = SECTORS.indexOf(t.segment) * 18;
    const [rIn, rOut] = ringOf(t.multiplier);
    return { bullR: null, d: wedge(rIn, rOut, at - 9, at + 9) };
  });

  // A tap on a field (0, 0: the edge - a miss).
  tap(segment: number, multiplier: number) {
    if (this.interactive()) this.tapped.emit({ segment, multiplier });
  }
}
