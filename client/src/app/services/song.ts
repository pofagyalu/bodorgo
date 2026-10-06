import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { Instrument } from '../pages/daloskonyv/chord-shapes';

const INSTRUMENT_KEY = 'daloskonyv-instrument';
const PLAYED_KEY = 'daloskonyv-played';
const LIST_KEY = 'daloskonyv-list';

// A song in the table of contents - no lyrics. The book is in the order of
// the titles.
export interface SongListItem {
  _id: string;
  title: string;
  artist: string;
  slug: string;
  // The song's key (hangnem) as its home chord - "C", "am": the one set
  // by hand ('' while none is), and the one its chords say ('' for a song
  // without chords). pages/daloskonyv/song-key.ts names them ("a-moll").
  key: string;
  detectedKey: string;
  // New to the one looking: someone else added it since their visit to the
  // songbook before this one (the server keeps the visits).
  isNew?: boolean;
  // The Daloskönyv's own song (its PDF, its count, its index) - or one
  // another user added beside the book.
  inBook: boolean;
  // Whose it is, on a song that isn't the book's own: the owner's given
  // name ("Melinda"), the tag it carries in the list. '' on the book's.
  ownerName: string;
  // The one looking may change and delete it: its owner, or the book's
  // keeper.
  canEdit: boolean;
}

export interface Song extends SongListItem {
  // Lyrics and chords as ChordPro text (pages/daloskonyv/chordpro.ts).
  chordpro: string;
  tags: string[];
  // The first chord it was first written with ("am") - there once the
  // song has been saved in another key; '' while it never was.
  originalKey: string;
  // Beats a minute, given by hand in the editor (pages/daloskonyv/tempo.ts)
  // - null: none.
  tempo: number | null;
  updatedAt: string;
}

// What the editor sends.
export interface SongInput {
  title: string;
  artist: string;
  chordpro: string;
  originalKey?: string;
  // The key set by hand ("C", "am"); '' leaves it to the chords.
  key?: string;
  // Beats a minute; null takes the tempo away.
  tempo?: number | null;
  // The book's keeper alone: true takes the song into the Daloskönyv -
  // and makes it the keeper's own.
  inBook?: boolean;
}

// A playlist: one's own named list of songs (their ids), in the order
// they were put in it. Nobody else sees it.
export interface SongPlaylist {
  _id: string;
  name: string;
  songs: string[];
}

// Whose chord diagrams the PDF has - or none.
export type BookDiagrams = Instrument | 'none';

// Daloskönyv: the club's songbook (the server's songController.js).
@Injectable({ providedIn: 'root' })
export class SongService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/songs`;
  private auth = inject(AuthService);

  // Where the songbook is: for members inside Média → Zene (with Média's
  // side menu around it); for guests, who have no Média, the page of its
  // own. Every link to the list, a song or the editor starts from here.
  readonly base = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'member' ? '/media/zene/daloskonyv' : '/daloskonyv';
  });

  // Whose chord diagrams the songbook shows - chosen on its main page,
  // remembered on this device.
  readonly instrument = signal<Instrument>(storedInstrument());

  setInstrument(instrument: Instrument) {
    this.instrument.set(instrument);
    try {
      localStorage.setItem(INSTRUMENT_KEY, instrument);
    } catch {
      // Private mode: not remembered.
    }
  }

  // The songs played tonight (their ids) - marked by hand on a song's page,
  // or by its play button reaching the end; shown in the list, and wiped
  // with one tap the next day. Kept on this device only.
  readonly played = signal<ReadonlySet<string>>(storedPlayed());

  setPlayed(id: string, played: boolean) {
    const next = new Set(this.played());
    if (played) next.add(id);
    else next.delete(id);
    this.savePlayed(next);
  }

  clearPlayed() {
    this.savePlayed(new Set());
  }

  private savePlayed(played: Set<string>) {
    this.played.set(played);
    try {
      localStorage.setItem(PLAYED_KEY, JSON.stringify([...played]));
    } catch {
      // Private mode: not remembered.
    }
  }

  // What the song list is narrowed to - typed on the songbook's main page,
  // or above an open song (the list is beside it then).
  readonly search = signal('');

  // The one artist the song list is narrowed to (exactly as the songs name
  // them) - chosen by a tap on the artist's name on a song's page, '' for
  // everyone. The search works within it.
  readonly artist = signal('');

  // The table of contents, in the book's order - null until it arrives.
  // Kept here so the song page's previous/next has it too.
  readonly songs = signal<SongListItem[] | null>(null);
  // The one looking is the book's keeper (the role manager): every song
  // is theirs to change. Anyone logged in may add a song - their own, to
  // change and delete (a song's own canEdit says so).
  readonly canEdit = signal(false);

  // The Daloskönyv's own songs - the book's count; the others stand beside
  // it. null until the list arrives.
  readonly bookSongs = computed(() => this.songs()?.filter((song) => song.inBook) ?? null);

  // When a song was last added or changed - the book's date on its
  // Dokumentumok card. null: not known yet, or no songs.
  readonly lastChanged = signal<string | null>(null);

  loadSongs() {
    this.http
      .get<{
        data: { songs: SongListItem[]; canEdit: boolean; lastChanged: string | null };
      }>(this.apiUrl)
      .subscribe({
        next: (res) => {
          this.songs.set(res.data.songs);
          this.canEdit.set(res.data.canEdit);
          this.lastChanged.set(res.data.lastChanged);
        },
        error: () => this.songs.update((songs) => songs ?? []),
      });
  }

  // Every song's words line by line, by the song's id - what the search
  // looks through beside the titles (pages/daloskonyv/search.ts).
  // undefined until they have arrived.
  readonly lyrics = signal<ReadonlyMap<string, string[]> | undefined>(undefined);
  // The book's state (lastChanged) the words were asked for.
  private lyricsOf: string | null = null;

  // Fetches the words - once per state of the book: asked again, it does
  // nothing until a song has been added or changed. One answer for all the
  // songs, compressed on the wire.
  loadLyrics() {
    const state = this.lastChanged();
    if (!state || state === this.lyricsOf) return;
    this.lyricsOf = state;
    this.http
      .get<{ data: { lyrics: { _id: string; lines: string[] }[] } }>(`${this.apiUrl}/lyrics`)
      .subscribe({
        next: (res) => this.lyrics.set(new Map(res.data.lyrics.map((l) => [l._id, l.lines]))),
        // The titles are still searched; the next change of the book (or
        // the next visit) tries again.
        error: () => (this.lyricsOf = null),
      });
  }

  getSong(slug: string): Observable<Song> {
    return this.http
      .get<{ data: { song: Song } }>(`${this.apiUrl}/${encodeURIComponent(slug)}`)
      .pipe(map((res) => res.data.song));
  }

  // The whole songbook as a PDF (the server draws it: songs/songBook.js) -
  // a plain link, the session cookie goes with it. download: saved rather
  // than opened.
  bookUrl(diagrams: BookDiagrams, download = false): string {
    const query = [
      diagrams === 'none' ? '' : `diagrams=${diagrams}`,
      download ? 'download=1' : '',
    ].filter(Boolean);
    return `${this.apiUrl}/book.pdf${query.length ? `?${query.join('&')}` : ''}`;
  }

  // One song alone as a PDF, saved as a file - the server draws it like its
  // page of the book. diagrams: whose chords to draw over the song, or
  // none; transpose: the semitones the song is moved by on the screen, so
  // the PDF is the song as it is shown.
  songPdfUrl(slug: string, diagrams: BookDiagrams, transpose = 0): string {
    const query = [
      diagrams === 'none' ? '' : `diagrams=${diagrams}`,
      transpose ? `transpose=${transpose}` : '',
      'download=1',
    ].filter(Boolean);
    return `${this.apiUrl}/${encodeURIComponent(slug)}/pdf?${query.join('&')}`;
  }

  // The book's cover as a small picture (its Dokumentumok card). version:
  // anything that changes when the book does, so the browser asks again.
  bookPreviewUrl(diagrams: BookDiagrams, version: string): string {
    const query = [
      diagrams === 'none' ? '' : `diagrams=${diagrams}`,
      `v=${encodeURIComponent(version)}`,
    ].filter(Boolean);
    return `${this.apiUrl}/book.webp?${query.join('&')}`;
  }

  // Adding: anyone logged in. Changing and deleting: the song's owner and
  // the book's keeper (the server says 403 to anyone else).
  createSong(input: SongInput): Observable<Song> {
    return this.http
      .post<{ data: { song: Song } }>(this.apiUrl, input)
      .pipe(map((res) => res.data.song));
  }

  // Only what is sent changes.
  updateSong(id: string, input: Partial<SongInput>): Observable<Song> {
    return this.http
      .patch<{ data: { song: Song } }>(`${this.apiUrl}/${id}`, input)
      .pipe(map((res) => res.data.song));
  }

  deleteSong(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  // --- Playlists: one's own named lists of songs (songListController.js) ---

  // My lists, by name - null until they arrive.
  readonly lists = signal<SongPlaylist[] | null>(null);

  // The list the songbook is on (its id) - '' for the whole book.
  // Remembered on this device.
  readonly listId = signal(storedList());

  // The list the songbook is on - null for the whole book (or while the
  // lists are on their way, or once that list is gone).
  readonly list = computed(() => this.lists()?.find((list) => list._id === this.listId()) ?? null);

  // The songs in the order they are played: the chosen list's songs in the
  // list's own order, or the whole book in its own. What the song page's
  // previous / next and its random pick go by. null until the songs arrive.
  readonly playOrder = computed(() => {
    const songs = this.songs();
    const list = this.list();
    if (!songs || !list) return songs;
    const byId = new Map(songs.map((song) => [song._id, song]));
    return list.songs.flatMap((id) => byId.get(id) ?? []);
  });

  chooseList(id: string) {
    this.listId.set(id);
    try {
      if (id) localStorage.setItem(LIST_KEY, id);
      else localStorage.removeItem(LIST_KEY);
    } catch {
      // Private mode: not remembered.
    }
  }

  loadLists() {
    this.http.get<{ data: { lists: SongPlaylist[] } }>(`${this.apiUrl}/lists`).subscribe({
      next: (res) => this.lists.set(res.data.lists),
      error: () => this.lists.update((lists) => lists ?? []),
    });
  }

  // A new, empty list - it becomes the one the songbook is on.
  createList(name: string): Observable<SongPlaylist> {
    return this.http.post<{ data: { list: SongPlaylist } }>(`${this.apiUrl}/lists`, { name }).pipe(
      map((res) => res.data.list),
      tap((list) => {
        this.lists.update((lists) => sortedLists([...(lists ?? []), list]));
        this.chooseList(list._id);
      }),
    );
  }

  renameList(id: string, name: string): Observable<SongPlaylist> {
    return this.patchList(id, { name });
  }

  // The list's songs anew, in their order. Shown at once - the server is
  // told after; if it refuses, the list is read again as it stands there.
  setListSongs(id: string, songs: string[]) {
    this.lists.update(
      (lists) => lists?.map((list) => (list._id === id ? { ...list, songs } : list)) ?? null,
    );
    this.patchList(id, { songs }).subscribe({ error: () => this.loadLists() });
  }

  // A song into the list (at its end), or out of it.
  toggleInList(id: string, songId: string) {
    const list = this.lists()?.find((l) => l._id === id);
    if (!list) return;
    this.setListSongs(
      id,
      list.songs.includes(songId)
        ? list.songs.filter((s) => s !== songId)
        : [...list.songs, songId],
    );
  }

  deleteList(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/lists/${id}`).pipe(
      tap(() => {
        this.lists.update((lists) => lists?.filter((list) => list._id !== id) ?? null);
        if (this.listId() === id) this.chooseList('');
      }),
    );
  }

  private patchList(id: string, change: { name?: string; songs?: string[] }) {
    return this.http
      .patch<{ data: { list: SongPlaylist } }>(`${this.apiUrl}/lists/${id}`, change)
      .pipe(
        map((res) => res.data.list),
        tap((saved) =>
          this.lists.update((lists) =>
            lists ? sortedLists(lists.map((list) => (list._id === id ? saved : list))) : lists,
          ),
        ),
      );
  }
}

const byHungarian = new Intl.Collator('hu', { sensitivity: 'base' });
const sortedLists = (lists: SongPlaylist[]) =>
  [...lists].sort((a, b) => byHungarian.compare(a.name, b.name));

function storedList(): string {
  try {
    return localStorage.getItem(LIST_KEY) ?? '';
  } catch {
    return '';
  }
}

function storedPlayed(): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function storedInstrument(): Instrument {
  try {
    return localStorage.getItem(INSTRUMENT_KEY) === 'ukulele' ? 'ukulele' : 'guitar';
  } catch {
    return 'guitar';
  }
}
