import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, firstValueFrom, from, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { Instrument } from '../pages/daloskonyv/chord-shapes';
import { detectKey } from '../pages/daloskonyv/song-key';
import { KeptBook, KeptSong, SongStore, WaitingSong } from './song-store';

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
  // Added without a connection: on this device only, until it can be sent
  // to the server. `refused`: the server wouldn't take it (why) - it waits
  // to be corrected.
  waiting?: boolean;
  refused?: string;
}

export interface Song extends SongListItem {
  // A line under the title, when the song has one - optional ('' or
  // missing: none).
  subtitle?: string;
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
  subtitle?: string;
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
  private store = inject(SongStore);

  // Where the songbook is: inside Média → Zene (with Média's side menu
  // around it) for everyone logged in - guests too. Every link to the
  // list, a song or the editor starts from here.
  readonly base = computed(() =>
    this.auth.isLoggedIn() ? '/media/zene/daloskonyv' : '/daloskonyv',
  );

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
          this.showSongs(res.data.songs);
          this.canEdit.set(res.data.canEdit);
          this.lastChanged.set(res.data.lastChanged);
          // The copy kept on the device follows a changed book.
          void this.keepForOffline(res.data.songs.length, res.data.lastChanged);
          // The server answers: what was added without it can go now.
          void this.sendWaiting();
        },
        // No answer: the list already here stays; without one, the book
        // kept on the device - or nothing.
        error: () => {
          if (this.songs()) return;
          if (!this.store.available) return this.songs.set([]);
          void this.kept().then((book) => {
            if (this.songs()) return;
            this.showSongs(book?.songs.map(listItem) ?? []);
            if (!book) return;
            this.canEdit.set(book.canEdit);
            this.lastChanged.set(book.lastChanged);
          });
        },
      });
  }

  // --- The songbook without a connection: the whole book is kept on the
  // device (song-store.ts), and read from there whenever the server gives
  // no answer - the list, the songs, their words for the search and one's
  // playlists. Reading only: nothing changed offline is sent later. ---

  // When the copy on this device was last brought up to date - null while
  // there is none (or it isn't known yet).
  readonly keptAt = signal<string | null>(null);

  // The copy as last read or written - undefined until it has been read.
  private keptBook: KeptBook | null | undefined;
  private keeping: Promise<void> | null = null;

  // The copy on this device, if it is the logged-in user's - or, with
  // nobody known to be logged in (no connection, nothing remembered of the
  // login), whoever's it is: it was kept on this device by its owner.
  private async kept(): Promise<KeptBook | null> {
    if (this.keptBook === undefined) this.keptBook = await this.store.read();
    const book = this.keptBook;
    const userId = this.auth.user()?.id;
    if (!book || (userId && book.userId !== userId)) return null;
    this.keptAt.set(book.savedAt);
    return book;
  }

  // Brings the copy on this device up to date: the app calls it by itself
  // once someone is logged in, and the songbook when its list shows another
  // state than the copy's (how many songs, last changed when). The songs
  // travel only when they have changed since.
  keepForOffline(count?: number, lastChanged?: string | null): Promise<void> {
    if (!this.store.available) return Promise.resolve();
    this.keeping ??= this.bringUpToDate(count, lastChanged).finally(() => (this.keeping = null));
    return this.keeping;
  }

  private async bringUpToDate(count?: number, lastChanged?: string | null) {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    const have = await this.kept();
    if (have && count === have.songs.length && lastChanged === have.lastChanged) return;
    try {
      const res = await firstValueFrom(
        this.http.get<{
          data: {
            version: string;
            songs: KeptSong[] | null;
            lists: SongPlaylist[];
            canEdit: boolean;
            lastChanged: string | null;
          };
        }>(`${this.apiUrl}/offline`, { params: have ? { have: have.version } : {} }),
      );
      const songs = res.data.songs ?? have?.songs;
      if (!songs) return;
      const book: KeptBook = {
        userId,
        version: res.data.version,
        savedAt: new Date().toISOString(),
        songs,
        lists: res.data.lists,
        canEdit: res.data.canEdit,
        lastChanged: res.data.lastChanged,
      };
      if (await this.store.write(book)) {
        this.keptBook = book;
        this.keptAt.set(book.savedAt);
      }
    } catch {
      // No connection, or no room: the copy stays as it is.
    }
  }

  // Logged out (the server said so - auth.service.ts): the copy goes with
  // the login.
  private forgetWhenLoggedOut = effect(() => {
    if (!this.auth.loggedOut()) return;
    this.keptBook = null;
    this.keptAt.set(null);
    void this.store.clear();
  });

  // --- A song added without a connection: kept on the device (the
  // store's waiting songs), shown in the list and opened like any other,
  // and sent to the server as soon as it answers again. Until then it can
  // be changed and deleted, here on the device. Only adding works this
  // way: a change to a song the server already has needs the server. ---

  // Everyone's waiting songs on this device - [] until they have been read.
  private waiting = signal<WaitingSong[]>([]);
  private waitingRead = this.store.readWaiting().then((songs) => this.waiting.set(songs));

  // The logged-in user's own.
  private myWaiting = computed(() => {
    const userId = this.auth.user()?.id;
    return userId ? this.waiting().filter((song) => song.userId === userId) : [];
  });
  // How many of one's songs are still to be sent.
  readonly waitingCount = computed(() => this.myWaiting().length);

  // What the last sending did - the app says so (app.component.ts).
  readonly lastSent = signal<{ sent: number; refused: number } | null>(null);

  // The addresses of the songs sent since the app was opened: the one each
  // had on the device → the one the server gave it.
  private sentAs = new Map<string, string>();
  private sending: Promise<void> | null = null;

  // The list with one's waiting songs in it, in the book's order.
  private showSongs(songs: SongListItem[]) {
    const mine = this.myWaiting();
    const fromServer = songs.filter((song) => !song.waiting);
    this.songs.set(
      mine.length
        ? [...fromServer, ...mine.map(waitingSong)].sort((a, b) =>
            byHungarian.compare(a.title, b.title),
          )
        : fromServer,
    );
  }

  // The waiting songs changed (read, added, sent), or who is logged in:
  // the list on the screen follows.
  private followWaiting = effect(() => {
    this.myWaiting();
    const songs = untracked(() => this.songs());
    if (songs) untracked(() => this.showSongs(songs));
  });

  private async saveWaiting(songs: WaitingSong[]): Promise<boolean> {
    if (!(await this.store.writeWaiting(songs))) return false;
    this.waiting.set(songs);
    return true;
  }

  // Sends one's waiting songs, the oldest first. Stops at the first one the
  // server can't be reached for; one it refuses (a title gone missing)
  // stays on the device with the reason, until it is corrected.
  sendWaiting(): Promise<void> {
    if (!this.store.available) return Promise.resolve();
    this.sending ??= this.send().finally(() => (this.sending = null));
    return this.sending;
  }

  private async send() {
    await this.waitingRead;
    let sent = 0;
    let refused = 0;
    for (const { localId } of this.myWaiting()) {
      // As it is now: it may have been changed, or deleted, meanwhile.
      const song = this.myWaiting().find((s) => s.localId === localId);
      if (!song || song.error) continue;
      try {
        const res = await firstValueFrom(
          this.http.post<{ data: { song: Song } }>(this.apiUrl, song.input),
        );
        this.sentAs.set(localId, res.data.song.slug);
        await this.saveWaiting(this.waiting().filter((s) => s.localId !== localId));
        sent += 1;
      } catch (err) {
        const failed = err as { status?: number; error?: { message?: string } };
        if (!failed?.status) break;
        const error = failed.error?.message ?? 'A szerver nem fogadta el a dalt.';
        await this.saveWaiting(
          this.waiting().map((s) => (s.localId === localId ? { ...s, error } : s)),
        );
        refused += 1;
      }
    }
    if (!sent && !refused) return;
    this.lastSent.set({ sent, refused });
    // The list with the songs as the server has them now.
    if (sent && this.songs()) this.loadSongs();
  }

  // One's playlists as they are now, into the copy on the device - they
  // change without the songs changing.
  private keepLists() {
    const lists = this.lists();
    const book = this.keptBook;
    if (!lists || !book || book.userId !== this.auth.user()?.id) return;
    this.keptBook = { ...book, lists };
    void this.store.write(this.keptBook);
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
        // the next visit) tries again. Meanwhile the words kept on the
        // device serve, if none are here.
        error: () => {
          this.lyricsOf = null;
          if (this.lyrics() || !this.store.available) return;
          void this.kept().then((book) => {
            if (book && !this.lyrics()) {
              this.lyrics.set(new Map(book.songs.map((song) => [song._id, song.lines])));
            }
          });
        },
      });
  }

  // One song, whole. When the server can't be reached at all, the one kept
  // on the device - an answer that is an error (no such song) stays one.
  getSong(slug: string): Observable<Song> {
    // A song still waiting on the device - or one sent since, under the
    // address the server gave it.
    if (isLocal(slug) && !this.sentAs.has(slug)) {
      return from(this.waitingRead).pipe(
        map(() => {
          const song = this.myWaiting().find((s) => s.localId === slug);
          if (!song) throw { status: 404 };
          return waitingSong(song);
        }),
      );
    }
    slug = this.sentAs.get(slug) ?? slug;
    return this.http
      .get<{ data: { song: Song } }>(`${this.apiUrl}/${encodeURIComponent(slug)}`)
      .pipe(
        map((res) => res.data.song),
        catchError((err) => {
          if (err?.status !== 0 || !this.store.available) throw err;
          return from(this.kept()).pipe(
            map((book) => {
              const song = book?.songs.find((kept) => kept.slug === slug);
              if (!song) throw err;
              return song;
            }),
          );
        }),
      );
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
  // When the server can't be reached at all, the song is kept on the
  // device and sent later (sendWaiting) - it comes back marked `waiting`.
  createSong(input: SongInput): Observable<Song> {
    return this.http.post<{ data: { song: Song } }>(this.apiUrl, input).pipe(
      map((res) => res.data.song),
      catchError((err) => {
        const userId = this.auth.user()?.id;
        if (err?.status !== 0 || !this.store.available || !userId) throw err;
        const { inBook: _inBook, ...kept } = input;
        const song: WaitingSong = {
          localId: `${LOCAL}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          userId,
          input: kept,
          savedAt: new Date().toISOString(),
        };
        return from(this.keepWaiting(song)).pipe(
          map((ok) => {
            if (!ok) throw err;
            return waitingSong(song);
          }),
        );
      }),
    );
  }

  private async keepWaiting(song: WaitingSong): Promise<boolean> {
    await this.waitingRead;
    return this.saveWaiting([...this.waiting(), song]);
  }

  // A waiting song changed on the device (changed: null deletes it). A
  // change takes the server's refusal off it: it is tried again.
  private changeWaiting(id: string, changed: Partial<SongInput> | null): Observable<Song | null> {
    const change = async () => {
      await this.waitingRead;
      const song = this.myWaiting().find((s) => s.localId === id);
      if (!song) throw { status: 404 };
      const { inBook: _inBook, ...fields } = changed ?? {};
      const next: WaitingSong | null = changed
        ? { ...song, input: { ...song.input, ...fields }, error: undefined }
        : null;
      const all = this.waiting().flatMap((s) => (s.localId === id ? (next ?? []) : s));
      if (!(await this.saveWaiting(all))) throw { status: 0 };
      if (next) void this.sendWaiting();
      return next ? waitingSong(next) : null;
    };
    return from(change());
  }

  // Only what is sent changes.
  updateSong(id: string, input: Partial<SongInput>): Observable<Song> {
    if (isLocal(id)) return this.changeWaiting(id, input).pipe(map((song) => song!));
    return this.http
      .patch<{ data: { song: Song } }>(`${this.apiUrl}/${id}`, input)
      .pipe(map((res) => res.data.song));
  }

  deleteSong(id: string): Observable<void> {
    if (isLocal(id)) return this.changeWaiting(id, null).pipe(map(() => undefined));
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
      next: (res) => {
        this.lists.set(res.data.lists);
        this.keepLists();
      },
      // No answer: the lists already here stay; without them, the ones kept
      // on the device.
      error: () => {
        if (this.lists()) return;
        if (!this.store.available) return this.lists.set([]);
        void this.kept().then((book) => this.lists.update((lists) => lists ?? book?.lists ?? []));
      },
    });
  }

  // A new, empty list - it becomes the one the songbook is on.
  createList(name: string): Observable<SongPlaylist> {
    return this.http.post<{ data: { list: SongPlaylist } }>(`${this.apiUrl}/lists`, { name }).pipe(
      map((res) => res.data.list),
      tap((list) => {
        this.lists.update((lists) => sortedLists([...(lists ?? []), list]));
        this.keepLists();
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
        this.keepLists();
        if (this.listId() === id) this.chooseList('');
      }),
    );
  }

  private patchList(id: string, change: { name?: string; songs?: string[] }) {
    return this.http
      .patch<{ data: { list: SongPlaylist } }>(`${this.apiUrl}/lists/${id}`, change)
      .pipe(
        map((res) => res.data.list),
        tap((saved) => {
          this.lists.update((lists) =>
            lists ? sortedLists(lists.map((list) => (list._id === id ? saved : list))) : lists,
          );
          this.keepLists();
        }),
      );
  }
}

// How a waiting song's id and address begin - no song of the server's has
// such an id, and its addresses are made of its titles' letters.
const LOCAL = 'local-';
const isLocal = (id: string) => id.startsWith(LOCAL);

// A waiting song as the app shows it: one's own, to change and delete.
function waitingSong(song: WaitingSong): Song {
  const { input } = song;
  return {
    _id: song.localId,
    slug: song.localId,
    title: input.title,
    subtitle: input.subtitle ?? '',
    artist: input.artist,
    key: input.key ?? '',
    detectedKey: detectKey(input.chordpro),
    // Whether it is the book's is the server's to say once it has it; no
    // owner's name stands on one's own song.
    inBook: true,
    ownerName: '',
    canEdit: true,
    waiting: true,
    refused: song.error,
    chordpro: input.chordpro,
    tags: [],
    originalKey: input.originalKey ?? '',
    tempo: input.tempo ?? null,
    updatedAt: song.savedAt,
  };
}

// A kept song as the table of contents has it - nothing is new offline.
function listItem(song: KeptSong): SongListItem {
  return {
    _id: song._id,
    title: song.title,
    artist: song.artist,
    slug: song.slug,
    key: song.key,
    detectedKey: song.detectedKey,
    inBook: song.inBook,
    ownerName: song.ownerName,
    canEdit: song.canEdit,
  };
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
