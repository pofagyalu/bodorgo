import { Component } from '@angular/core';

// The numbers clockwise from the top, as on a real board.
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// The rings' radii in the 450-wide drawing - a real board's proportions,
// the double and triple rings a little wider so they read when it's small.
const R = { bull: 8, outerBull: 19, tripleIn: 95, tripleOut: 111, doubleIn: 152, doubleOut: 172 };
const NUMBER_R = 196;

// A point on the board: the angle in degrees, clockwise from the top.
const point = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return `${(r * Math.sin(rad)).toFixed(2)} ${(-r * Math.cos(rad)).toFixed(2)}`;
};

// One number's slice of a ring, between two radii.
const wedge = (rIn: number, rOut: number, from: number, to: number) =>
  `M${point(rOut, from)} A${rOut} ${rOut} 0 0 1 ${point(rOut, to)} ` +
  `L${point(rIn, to)} A${rIn} ${rIn} 0 0 0 ${point(rIn, from)} Z`;

// A dartboard in a real one's colors: every number's single, double and
// triple fields, the two bulls and the numbers around. It builds up slice
// by slice when it appears. Only a picture, on the Darts opening page -
// the darts themselves are typed on the game's keypad.
@Component({
  selector: 'app-dart-board',
  templateUrl: './dart-board.html',
  styleUrl: './dart-board.scss',
})
export class DartBoard {
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
}
