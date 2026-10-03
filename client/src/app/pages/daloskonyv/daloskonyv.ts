import { Component, OnInit, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { SongListItem, SongService } from '../../services/song';
import { keyName } from './song-key';
import { Instrument } from './chord-shapes';
import { ANNEXES } from './annexes';
import { fold, searchSongs, songsOf } from './search';

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

  // What the search finds (search.ts): the songs with it in their title or
  // artist, then the ones with it only in their words - those with the
  // line it was found in. Without a search: every song.
  // Narrowed first to the one artist chosen on a song's page, if any.
  found = computed(() =>
    searchSongs(
      songsOf(this.songs() ?? [], this.artist()),
      this.search(),
      this.songService.lyrics(),
    ),
  );
  filtered = computed(() => this.found().map((f) => f.song));

  // The artist the list is narrowed to ('' for none), and the way back to
  // everyone's songs.
  artist = this.songService.artist;

  clearArtist() {
    this.artist.set('');
  }

  // A song's key as the list shows it ("a-moll"): the one set by hand, or
  // the one its chords say - '' for a song without chords.
  keyOf(song: SongListItem): string {
    return keyName(song.key || song.detectedKey);
  }

  // The pages that aren't songs (the tuner, the two annexes) - in the list
  // before the songs, found by the same search.
  annexes = computed(() => {
    // One artist's songs: no place for the pages that aren't songs.
    if (this.artist()) return [];
    const q = fold(this.search().trim());
    return q
      ? ANNEXES.filter((a) => fold(`${a.title} ${a.about} ${a.keywords}`).includes(q))
      : ANNEXES;
  });

  constructor() {
    // The songs' words, for the search: fetched once the list is here, and
    // again when a song has changed since (the service knows which it has).
    effect(() => {
      if (this.songService.lastChanged()) this.songService.loadLyrics();
    });
  }

  ngOnInit() {
    this.songService.loadSongs();
  }
}
