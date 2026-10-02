import { Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { SongService } from '../../services/song';
import { Instrument } from './chord-shapes';
import { ANNEXES } from './annexes';

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

  // What is open beside the list: a song (its slug) or an annex (its id) -
  // both null on the table of contents itself.
  private open = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => {
        // Created together with its child (arriving from the editor, or
        // straight at a song's address), the child has no snapshot yet -
        // the NavigationEnd that follows brings it.
        const params = this.route.firstChild?.snapshot?.paramMap;
        return { slug: params?.get('slug') ?? null, annex: params?.get('annex') ?? null };
      }),
    ),
    { initialValue: { slug: null, annex: null } },
  );
  openSlug = computed(() => this.open().slug);
  openAnnex = computed(() => this.open().annex);
  isOpen = computed(() => !!(this.openSlug() || this.openAnnex()));

  filtered = computed(() => {
    const songs = this.songs() ?? [];
    const q = fold(this.search().trim());
    return q ? songs.filter((s) => fold(`${s.title} ${s.artist}`).includes(q)) : songs;
  });

  // The pages that aren't songs (the tuner, the two annexes) - in the list
  // before the songs, found by the same search.
  annexes = computed(() => {
    const q = fold(this.search().trim());
    return q
      ? ANNEXES.filter((a) => fold(`${a.title} ${a.about} ${a.keywords}`).includes(q))
      : ANNEXES;
  });

  ngOnInit() {
    this.songService.loadSongs();
  }
}
