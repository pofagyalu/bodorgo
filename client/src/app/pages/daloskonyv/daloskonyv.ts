import { Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { SongService } from '../../services/song';
import { Instrument } from './chord-shapes';

// "Eső után" → "eso utan": the search doesn't mind accents or capitals.
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

// Daloskönyv: the club's songbook - for everyone logged in. The table of
// contents (searchable), and the chosen song beside it (song/song.ts, the
// child route): on a phone the song takes the list's place, on a wide
// screen the list stays on the left.
@Component({
  selector: 'app-daloskonyv',
  imports: [RouterLink, RouterOutlet, MatIconModule],
  templateUrl: './daloskonyv.html',
  styleUrl: './daloskonyv.scss',
})
export class Daloskonyv implements OnInit {
  private songService = inject(SongService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  songs = this.songService.songs;
  canEdit = this.songService.canEdit;
  base = this.songService.base;
  instrument = this.songService.instrument;
  search = this.songService.search;

  // The whole book as a PDF, with the chosen instrument's chord diagrams.
  bookUrl = computed(() => this.songService.bookUrl(this.instrument(), true));

  // The songs played tonight - marked in the list, wiped with one tap.
  played = this.songService.played;

  clearPlayed() {
    this.songService.clearPlayed();
  }

  chooseInstrument(instrument: Instrument) {
    this.songService.setInstrument(instrument);
  }

  // The open song's slug - null on the table of contents itself.
  openSlug = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => this.route.firstChild?.snapshot.paramMap.get('slug') ?? null),
    ),
    { initialValue: null },
  );

  filtered = computed(() => {
    const songs = this.songs() ?? [];
    const q = fold(this.search().trim());
    return q ? songs.filter((s) => fold(`${s.title} ${s.artist}`).includes(q)) : songs;
  });

  ngOnInit() {
    this.songService.loadSongs();
  }
}
