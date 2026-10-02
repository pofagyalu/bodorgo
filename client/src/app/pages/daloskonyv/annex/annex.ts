import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { map } from 'rxjs';
import { SongService } from '../../../services/song';
import { ANNEXES } from '../annexes';
import { Instrument } from '../chord-shapes';
import { Tuner } from '../tuner/tuner';
import { CircleOfFifths } from '../circle-of-fifths/circle-of-fifths';
import { ChordTable } from '../chord-table/chord-table';

// One of the songbook's pages that aren't songs (annexes.ts): the tuner,
// the circle of fifths, the table of the keys' chords - in a song's place,
// beside the list on a wide screen, over the whole screen on a phone.
@Component({
  selector: 'app-annex',
  imports: [RouterLink, MatIconModule, Tuner, CircleOfFifths, ChordTable],
  templateUrl: './annex.html',
  styleUrl: './annex.scss',
})
export class AnnexPage {
  private songService = inject(SongService);
  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('annex') ?? '')), {
    initialValue: '',
  });

  base = this.songService.base;
  search = this.songService.search;
  // Whose strings the tuner aims for.
  instrument = this.songService.instrument;

  // Which page - null for an address that is none of them.
  annex = computed(() => ANNEXES.find((a) => a.id === this.id()) ?? null);

  chooseInstrument(instrument: Instrument) {
    this.songService.setInstrument(instrument);
  }
}
