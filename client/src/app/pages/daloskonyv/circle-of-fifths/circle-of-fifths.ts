import { Component } from '@angular/core';
import { CIRCLE } from '../keys';

// The picture's own measures: a 500 × 500 square, the circle in its middle.
const CENTRE = 250;
// The rings, from the outside in: major keys, their minors, the signs.
const RINGS = [246, 178, 124, 82];

// The wedges' colours: the sharp keys warm, the flat keys cool, C between
// - the same as on the PDF's last page (the server's songBookCircle.js).
const TINTS = [
  '#f6b528',
  '#f39a27',
  '#f07827',
  '#e0583a',
  '#c9433f',
  '#a8456b',
  '#7a4f8f',
  '#4f5aa3',
  '#096396',
  '#1b7f86',
  '#1b6548',
  '#72b45d',
];

const point = (radius: number, degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return { x: CENTRE + radius * Math.cos(a), y: CENTRE + radius * Math.sin(a) };
};

// A slice of a ring: between two radii and two angles.
function wedge(inner: number, outer: number, from: number, to: number): string {
  const [a, b, c, d] = [point(outer, from), point(outer, to), point(inner, to), point(inner, from)];
  return `M${a.x} ${a.y} A${outer} ${outer} 0 0 1 ${b.x} ${b.y} L${c.x} ${c.y} A${inner} ${inner} 0 0 0 ${d.x} ${d.y}Z`;
}

// The circle of fifths (Kvintkör), in the songbook's notation: the major
// keys around, each with its relative minor and how many sharps or flats
// it is written with. Drawn, so it is sharp at any size.
@Component({
  selector: 'app-circle-of-fifths',
  templateUrl: './circle-of-fifths.html',
  styleUrl: './circle-of-fifths.scss',
})
export class CircleOfFifths {
  readonly centre = CENTRE;
  readonly outer = RINGS[0];

  readonly keys = CIRCLE.map((key, i) => {
    // C at the top: its wedge is the 30° around straight up.
    const from = -105 + i * 30;
    const middle = from + 15;
    return {
      ...key,
      tint: TINTS[i],
      wedges: [0, 1, 2].map((ring) => wedge(RINGS[ring + 1], RINGS[ring], from, from + 30)),
      majorAt: point((RINGS[0] + RINGS[1]) / 2, middle),
      minorAt: point((RINGS[1] + RINGS[2]) / 2, middle),
      signsAt: point((RINGS[2] + RINGS[3]) / 2, middle),
    };
  });

  // The fill of a key's three rings: fainter towards the middle.
  readonly opacities = [0.3, 0.16, 0.07];
}
