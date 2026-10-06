import {
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { SongListItem, SongService } from '../../services/song';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
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
  imports: [
    NgTemplateOutlet,
    RouterLink,
    RouterOutlet,
    MatIconModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  templateUrl: './daloskonyv.html',
  styleUrl: './daloskonyv.scss',
})
export class Daloskonyv implements OnInit {
  private songService = inject(SongService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
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

  // Inside Média (members): its own menu says where one is, so a phone
  // needs no heading here. Guests have the page on its own.
  inMedia = computed(() => this.base() !== '/daloskonyv');

  // A phone keeps the first row's controls (the instrument, the PDF, the
  // played marks) behind one button: open, they drop down over the songs.
  controlsOpen = signal(false);
  // One panel at a time: the controls' or the playlists'.
  toggleControls() {
    this.listsOpen.set(false);
    this.controlsOpen.set(!this.controlsOpen());
  }
  toggleLists() {
    this.controlsOpen.set(false);
    this.listsOpen.set(!this.listsOpen());
  }

  // --- Playlists: one's own lists of songs (services/song.ts) ---

  lists = this.songService.lists;
  // The list the songbook is on - null for the whole book.
  playlist = this.songService.list;
  // The panel with every list to choose from, and the new list's name.
  listsOpen = signal(false);
  newListName = signal('');
  // Picking: the whole book is shown, each song with a tick box - a tap
  // puts it into the chosen list, or takes it out.
  picking = signal(false);
  // Ordering: the list's songs with a handle each, to drag into place.
  ordering = signal(false);
  // The chosen list's new name, while it is being typed - null otherwise.
  renaming = signal<string | null>(null);

  // The chosen list's songs, for the tick boxes.
  private inPlaylist = computed(() => new Set(this.playlist()?.songs ?? []));
  isInPlaylist(song: SongListItem) {
    return this.inPlaylist().has(song._id);
  }

  chooseList(id: string) {
    this.songService.chooseList(id);
    this.listsOpen.set(false);
    this.picking.set(false);
    this.ordering.set(false);
    this.renaming.set(null);
  }

  createList() {
    const name = this.newListName().trim();
    if (!name) return;
    this.songService.createList(name).subscribe({
      next: () => {
        this.newListName.set('');
        this.listsOpen.set(false);
        this.renaming.set(null);
        this.ordering.set(false);
        // A new list is empty: straight to filling it.
        this.picking.set(true);
      },
      error: (err) =>
        this.notifications.addError(err?.error?.message ?? 'A listát nem sikerült létrehozni.'),
    });
  }

  togglePicking() {
    this.picking.update((on) => !on);
    this.ordering.set(false);
  }

  // Ordering goes by the list as it stands: a search or an artist would
  // show only some of its songs.
  toggleOrdering() {
    this.ordering.update((on) => !on);
    this.picking.set(false);
    if (this.ordering()) {
      this.search.set('');
      this.artist.set('');
    }
  }

  // A row of the song list: while picking, a tap ticks the song in or out
  // of the list - it doesn't open it.
  onRowClick(event: Event, song: SongListItem) {
    const list = this.playlist();
    if (!this.picking() || !list) return;
    event.preventDefault();
    event.stopPropagation();
    this.songService.toggleInList(list._id, song._id);
  }

  // A song dragged to a new place in the list.
  moveSong(drop: CdkDragDrop<unknown>) {
    const list = this.playlist();
    if (!list || drop.previousIndex === drop.currentIndex) return;
    // The rows are the list's songs that still exist, in its order.
    const songs = this.filtered().map((song) => song._id);
    moveItemInArray(songs, drop.previousIndex, drop.currentIndex);
    this.songService.setListSongs(list._id, songs);
  }

  startRenaming() {
    this.listsOpen.set(false);
    this.renaming.set(this.playlist()?.name ?? null);
  }

  rename() {
    const list = this.playlist();
    const name = this.renaming()?.trim();
    if (!list || !name) return;
    this.songService.renameList(list._id, name).subscribe({
      next: () => this.renaming.set(null),
      error: (err) =>
        this.notifications.addError(err?.error?.message ?? 'A listát nem sikerült átnevezni.'),
    });
  }

  async deleteList() {
    const list = this.playlist();
    if (!list) return;
    this.listsOpen.set(false);
    const ok = await this.confirm.ask({
      title: 'Lista törlése',
      message: `Biztosan törlöd ezt a listát: „${list.name}”?`,
      detail: 'A dalok a daloskönyvben megmaradnak, csak a lista tűnik el.',
    });
    if (!ok) return;
    this.songService.deleteList(list._id).subscribe({
      next: () => {
        this.picking.set(false);
        this.ordering.set(false);
        this.renaming.set(null);
      },
      error: (err) =>
        this.notifications.addError(err?.error?.message ?? 'A listát nem sikerült törölni.'),
    });
  }

  // What the search finds (search.ts): the songs with it in their title or
  // artist, then the ones with it only in their words - those with the
  // line it was found in. Without a search: every song.
  // Narrowed first to the chosen playlist - its songs in its own order
  // (while picking, the whole book: that is where its songs are picked
  // from) -, then to the one artist chosen on a song's page, if any.
  found = computed(() =>
    searchSongs(
      songsOf(
        (this.playlist() && !this.picking() ? this.songService.playOrder() : this.songs()) ?? [],
        this.artist(),
      ),
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
    // A playlist is in its own order, not the alphabet's.
    if (this.search().trim() || (this.playlist() && !this.picking())) return heads;
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
    this.songService.loadLists();
  }
}
