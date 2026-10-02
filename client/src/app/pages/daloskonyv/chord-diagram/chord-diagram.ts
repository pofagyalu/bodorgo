import { Component, computed, input } from '@angular/core';
import { ChordShape } from '../chord-shapes';

// The picture's measures, in the SVG's own units.
const STRING_GAP = 12;
const FRET_GAP = 15;
const LEFT = 16;
const TOP = 14;
const MIN_FRETS = 4;

// A chord's diagram: the neck from above - strings down, frets across, a
// dot where a finger goes, ○ over an open string, × over one not played,
// a bar for a finger across several strings, and the fret's number at the
// side when the shape sits higher up the neck. As many strings as the
// shape has: six for the guitar, four for the ukulele.
@Component({
  selector: 'app-chord-diagram',
  templateUrl: './chord-diagram.html',
  styleUrl: './chord-diagram.scss',
})
export class ChordDiagram {
  name = input.required<string>();
  // null: a chord there is no shape for.
  shape = input.required<ChordShape | null>();

  view = computed(() => {
    const shape = this.shape();
    if (!shape) return null;
    const held = shape.frets.filter((f) => f > 0);
    const top = Math.max(0, ...held);
    // From the nut while it fits; otherwise from the lowest held fret.
    const base = top <= MIN_FRETS ? 1 : Math.min(...held);
    const rows = Math.max(MIN_FRETS, top - base + 1);
    const strings = shape.frets.length;
    const x = (i: number) => LEFT + i * STRING_GAP;
    const y = (fret: number) => TOP + (fret - base + 0.5) * FRET_GAP;
    const width = LEFT + (strings - 1) * STRING_GAP + 8;
    const height = TOP + rows * FRET_GAP + 4;
    const barre = shape.barre;

    return {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      left: LEFT,
      right: x(strings - 1),
      top: TOP,
      bottom: TOP + rows * FRET_GAP,
      nut: base === 1,
      baseLabel: base === 1 ? null : { text: `${base}.`, y: y(base) + 3 },
      stringLines: shape.frets.map((_, i) => x(i)),
      fretLines: Array.from({ length: rows + 1 }, (_, r) => TOP + r * FRET_GAP),
      dots: shape.frets.flatMap((f, i) =>
        // Under the bar there is no dot of its own.
        f > 0 && !(barre && f === barre.fret && i >= barre.from && i <= barre.to)
          ? [{ x: x(i), y: y(f) }]
          : [],
      ),
      barre: barre && {
        x: x(barre.from) - 4,
        y: y(barre.fret) - 4,
        width: x(barre.to) - x(barre.from) + 8,
      },
      open: shape.frets.flatMap((f, i) => (f === 0 ? [x(i)] : [])),
      muted: shape.frets.flatMap((f, i) => (f < 0 ? [x(i)] : [])),
    };
  });
}
