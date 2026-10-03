import { Component, computed, input } from '@angular/core';
import { chordNamePieces } from '../chords';

// A chord's name written out, its numbers as indexes - raised and smaller
// (F⁷, Gsus², am⁷/G). Wherever a chord is named: over the lyrics, over its
// diagram. What isn't a chord ("Intro", "2x") is written as it is.
@Component({
  selector: 'app-chord-name',
  templateUrl: './chord-name.html',
  styleUrl: './chord-name.scss',
})
export class ChordName {
  name = input.required<string>();
  pieces = computed(() => chordNamePieces(this.name()));
}
