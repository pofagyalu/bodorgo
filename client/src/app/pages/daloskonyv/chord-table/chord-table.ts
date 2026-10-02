import { Component } from '@angular/core';
import { DEGREES, keyChords } from '../keys';

// Akkordtáblázat: for every major key the seven chords built on its notes
// - what a song in that key is most likely made of. For finding a song's
// chords by ear: once the key is known, its row is where to look - the
// three main chords (I, IV, V) first, then vi.
@Component({
  selector: 'app-chord-table',
  templateUrl: './chord-table.html',
  styleUrl: './chord-table.scss',
})
export class ChordTable {
  readonly degrees = DEGREES;
  readonly keys = keyChords();
}
