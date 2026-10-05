import { Component, ElementRef, OnInit, computed, effect, inject, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { SongListItem, SongService } from '../../services/song';
import { keyName } from './song-key';
import { Instrument } from './chord-shapes';
import { ANNEXES } from './annexes';
import { LETTERS, fold, foundIn, hungarianLetter, letterOf, searchSongs, songsOf } from './search';

// Daloskönyv: the club's songbook - for everyone logged in. The table of
// contents (searchable), and the chosen song beside it (song/song.ts, the
// child route): on a phone the song takes the list's place, on a wide
// screen the list stays on the left.
@Component({
  selector: 'app-daloskonyv',
  imports: [NgTemplateOutlet, RouterLink, RouterOutlet, MatIconModule],
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

  // A title or an artist's name cut around what is searched for, to show
  // it marked - null where it isn't in it.
  markIn(text: string) {
    return foundIn(text, this.search());
  }

  // --- The alphabet down the list's side ---

  readonly letters = LETTERS;
  private list = viewChild<ElementRef<HTMLElement>>('list');

  // The first song under each letter, by the song's id - the row a tap on
  // the letter brings to the top.
  firstOfLetter = computed(() => {
    const seen = new Set<string>();
    const first = new Map<string, string>();
    for (const { song } of this.found()) {
      const letter = letterOf(song.title);
      if (seen.has(letter)) continue;
      seen.add(letter);
      first.set(song._id, letter);
    }
    return first;
  });
  // The list's headings: the letter of the Hungarian alphabet over the
  // first song that stands under it (by the song's id) - "A", "B", "Cs"…
  // None over the titles that start with a number. Only while the list is
  // in the book's order: what a search finds comes by how well it fits,
  // not by the alphabet.
  letterHeads = computed(() => {
    const heads = new Map<string, string>();
    if (this.search().trim()) return heads;
    let last = '';
    for (const { song } of this.found()) {
      const letter = hungarianLetter(song.title);
      if (letter && letter !== last) heads.set(song._id, letter);
      last = letter;
    }
    return heads;
  });

  // The letters that have a song - the others are pale, and lead nowhere.
  hasLetter = computed(() => new Set(this.firstOfLetter().values()));

  jumpTo(letter: string) {
    const list = this.list()?.nativeElement;
    const row = list?.querySelector<HTMLElement>(`li[data-letter="${letter}"]`);
    if (!list || !row) return;
    const top = list.scrollTop + row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top, behavior: 'smooth' });
  }

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
