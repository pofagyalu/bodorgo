import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { AuthService } from '../auth/auth.service';
import { Song, SongService } from './song';
import { KeptBook, KeptSong, SongStore, WaitingSong } from './song-store';
import { OfflineService } from './offline';

const songs = `${API}/songs`;

// The device's store, in memory.
class FakeStore {
  available = true;
  book: KeptBook | null = null;
  read = vi.fn(async () => this.book);
  write = vi.fn(async (book: KeptBook) => {
    this.book = book;
    return true;
  });
  clear = vi.fn(async () => {
    this.book = null;
  });
  waiting: WaitingSong[] = [];
  readWaiting = vi.fn(async () => this.waiting);
  writeWaiting = vi.fn(async (songs: WaitingSong[]) => {
    this.waiting = songs;
    return true;
  });
}

const kept = (slug: string, title: string): KeptSong =>
  ({
    _id: `id-${slug}`,
    title,
    artist: 'Valaki',
    slug,
    key: '',
    detectedKey: 'C',
    inBook: true,
    ownerName: '',
    canEdit: false,
    chordpro: `[C]${title}`,
    lines: [title],
  }) as KeptSong;

const book = (over: Partial<KeptBook> = {}): KeptBook => ({
  userId: 'u1',
  version: '2|5',
  savedAt: '2026-10-01T10:00:00.000Z',
  songs: [kept('a', 'Alma'), kept('b', 'Barack')],
  lists: [{ _id: 'l1', name: 'Tábortűz', songs: ['id-b'] }],
  canEdit: false,
  lastChanged: 'x',
  ...over,
});

function setUp(stored: KeptBook | null = null, waiting: WaitingSong[] = []) {
  const store = new FakeStore();
  store.book = stored;
  store.waiting = waiting;
  TestBed.configureTestingModule({
    providers: [httpTesting(), { provide: SongStore, useValue: store }],
  });
  return {
    store,
    service: TestBed.inject(SongService),
    http: TestBed.inject(HttpTestingController),
  };
}

function logIn(http: HttpTestingController, id = 'u1') {
  TestBed.inject(AuthService).checkAuth().subscribe();
  http.expectOne(`${API}/auth/me`).flush({ loggedIn: true, id, role: 'member' });
}

// Lets the store's promises and what follows them run.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

const noNetwork = { status: 0, statusText: 'Unknown Error' };

describe('SongService without a connection', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the whole book on the device once someone is logged in', async () => {
    const { service, http, store } = setUp();
    // Nobody logged in: nothing is asked for.
    await service.keepForOffline();
    http.expectNone(`${songs}/offline`);

    logIn(http);
    const keeping = service.keepForOffline();
    void service.keepForOffline(); // already on its way
    await settle();
    const req = http.expectOne(`${songs}/offline`);
    req.flush({
      data: { version: '2|5', songs: book().songs, lists: [], canEdit: true, lastChanged: 'x' },
    });
    await keeping;
    expect(store.book).toMatchObject({ userId: 'u1', version: '2|5', canEdit: true });
    expect(store.book?.songs).toHaveLength(2);
    expect(service.keptAt()).toBe(store.book?.savedAt);
  });

  it('asks only for what changed, and keeps the songs it has when none are sent', async () => {
    const { service, http, store } = setUp(book());
    logIn(http);
    const keeping = service.keepForOffline();
    await settle();
    const req = http.expectOne((r) => r.url === `${songs}/offline`);
    expect(req.request.params.get('have')).toBe('2|5');
    req.flush({
      data: { version: '2|5', songs: null, lists: [], canEdit: false, lastChanged: 'x' },
    });
    await keeping;
    expect(store.book?.songs).toHaveLength(2);
    expect(store.book?.lists).toEqual([]);

    // The songbook's list shows the same state: nothing to ask for...
    await service.keepForOffline(2, 'x');
    http.expectNone((r) => r.url === `${songs}/offline`);
    // ...another one: asked again. Without an answer the copy stays.
    const again = service.keepForOffline(3, 'y');
    await settle();
    http.expectOne((r) => r.url === `${songs}/offline`).flush('', noNetwork);
    await again;
    expect(store.book?.songs).toHaveLength(2);
  });

  it('asks for the whole book when the copy is another user’s', async () => {
    const { service, http, store } = setUp(book({ userId: 'somebody-else' }));
    logIn(http);
    const keeping = service.keepForOffline();
    await settle();
    const req = http.expectOne((r) => r.url === `${songs}/offline`);
    expect(req.request.params.has('have')).toBe(false);
    req.flush({
      data: { version: '1|9', songs: [kept('c', 'Cseresznye')], lists: [], lastChanged: 'z' },
    });
    await keeping;
    expect(store.book).toMatchObject({ userId: 'u1', version: '1|9' });
  });

  it('shows the kept list, lyrics and playlists when the server gives no answer', async () => {
    const { service, http } = setUp(book());
    service.loadSongs();
    http.expectOne(songs).flush('', noNetwork);
    await settle();
    expect(service.songs()?.map((s) => s.title)).toEqual(['Alma', 'Barack']);
    expect((service.songs()?.[0] as unknown as Song).chordpro).toBeUndefined();
    expect(service.lastChanged()).toBe('x');
    expect(service.keptAt()).toBe('2026-10-01T10:00:00.000Z');

    service.loadLyrics();
    http.expectOne(`${songs}/lyrics`).flush('', noNetwork);
    await settle();
    expect(service.lyrics()?.get('id-b')).toEqual(['Barack']);

    service.loadLists();
    http.expectOne(`${songs}/lists`).flush('', noNetwork);
    await settle();
    expect(service.lists()?.map((l) => l.name)).toEqual(['Tábortűz']);
  });

  it('shows an empty list when nothing was kept', async () => {
    const { service, http } = setUp();
    service.loadSongs();
    http.expectOne(songs).flush('', noNetwork);
    service.loadLists();
    http.expectOne(`${songs}/lists`).flush('', noNetwork);
    await settle();
    expect(service.songs()).toEqual([]);
    expect(service.lists()).toEqual([]);
  });

  it('opens a kept song when the server is out of reach - but an error stays one', async () => {
    const { service, http } = setUp(book());
    const got: (string | number)[] = [];
    const open = (slug: string) =>
      service.getSong(slug).subscribe({
        next: (song) => got.push(song.chordpro),
        error: (err) => got.push(err.status),
      });

    open('b');
    http.expectOne(`${songs}/b`).flush('', noNetwork);
    await settle();
    // Not among the kept ones.
    open('nincs');
    http.expectOne(`${songs}/nincs`).flush('', noNetwork);
    await settle();
    // The server answered: no such song (deleted since).
    open('a');
    http.expectOne(`${songs}/a`).flush('', { status: 404, statusText: 'Not Found' });
    await settle();
    expect(got).toEqual(['[C]Barack', 0, 404]);
  });

  it('keeps the playlists as they change, and forgets everything at logout', async () => {
    const { service, http, store } = setUp(book());
    logIn(http);
    service.loadSongs();
    http.expectOne(songs).flush({
      data: { songs: book().songs, canEdit: false, lastChanged: 'x' },
    });
    await settle();
    http.expectNone((r) => r.url === `${songs}/offline`); // the same state

    service.loadLists();
    http.expectOne(`${songs}/lists`).flush({ data: { lists: [] } });
    expect(store.book?.lists).toEqual([]);
    service.createList('Új').subscribe();
    http
      .expectOne(`${songs}/lists`)
      .flush({ data: { list: { _id: 'l2', name: 'Új', songs: [] } } });
    expect(store.book?.lists.map((l) => l.name)).toEqual(['Új']);
    service.setListSongs('l2', ['id-a']);
    http
      .expectOne(`${songs}/lists/l2`)
      .flush({ data: { list: { _id: 'l2', name: 'Új', songs: ['id-a'] } } });
    expect(store.book?.lists[0].songs).toEqual(['id-a']);
    service.deleteList('l2').subscribe();
    http.expectOne(`${songs}/lists/l2`).flush(null);
    expect(store.book?.lists).toEqual([]);

    // The server says nobody is logged in any more.
    TestBed.inject(AuthService).checkAuth().subscribe();
    http.expectOne(`${API}/auth/me`).flush({ loggedIn: false });
    TestBed.tick();
    expect(store.clear).toHaveBeenCalled();
    expect(service.keptAt()).toBeNull();
  });

  it('takes a server that is out of reach for no logout', () => {
    const { http, store } = setUp(book());
    logIn(http);
    TestBed.inject(AuthService).checkAuth().subscribe();
    http.expectOne(`${API}/auth/me`).flush('', noNetwork);
    TestBed.tick();
    expect(store.clear).not.toHaveBeenCalled();
  });
});

describe('A song added without a connection', () => {
  beforeEach(() => localStorage.clear());

  const input = { title: 'Körte', artist: 'Én', chordpro: '[C]Körte [G]érik' };
  const add = async (service: SongService, http: HttpTestingController, body = input) => {
    let saved: Song | undefined;
    let failed: unknown;
    service.createSong(body).subscribe({ next: (s) => (saved = s), error: (e) => (failed = e) });
    http.expectOne({ method: 'POST', url: songs }).flush('', noNetwork);
    await settle();
    return { saved, failed };
  };

  it('is kept on the device, shown in the list and opened like any other', async () => {
    const { service, http, store } = setUp(book());
    logIn(http);
    service.loadSongs();
    http.expectOne(songs).flush('', noNetwork);
    await settle();

    const { saved } = await add(service, http);
    expect(saved).toMatchObject({ title: 'Körte', waiting: true, canEdit: true, detectedKey: 'C' });
    expect(saved?.slug).toMatch(/^local-/);
    expect(store.waiting).toHaveLength(1);
    expect(store.waiting[0]).toMatchObject({ userId: 'u1', input });
    expect(service.waitingCount()).toBe(1);
    TestBed.tick();
    // In the book's order, among the kept ones.
    expect(service.songs()?.map((s) => s.title)).toEqual(['Alma', 'Barack', 'Körte']);

    let opened: Song | undefined;
    service.getSong(saved!.slug).subscribe((s) => (opened = s));
    await settle();
    expect(opened?.chordpro).toBe('[C]Körte [G]érik');
  });

  it('is not kept when the server answered with an error, or nobody is logged in', async () => {
    const { service, http, store } = setUp();
    // Nobody is known to be logged in.
    expect((await add(service, http)).failed).toMatchObject({ status: 0 });
    logIn(http);
    let failed: { status?: number } | undefined;
    service.createSong({ ...input, title: '' }).subscribe({ error: (e) => (failed = e) });
    http
      .expectOne({ method: 'POST', url: songs })
      .flush({ message: 'A dalnak kell legyen címe.' }, { status: 400, statusText: 'Bad' });
    expect(failed?.status).toBe(400);
    expect(store.waiting).toEqual([]);
  });

  it('can be changed and deleted on the device while it waits', async () => {
    const { service, http, store } = setUp();
    logIn(http);
    const { saved } = await add(service, http);
    const id = saved!._id;

    let changed: Song | undefined;
    service.updateSong(id, { title: 'Érett körte' }).subscribe((s) => (changed = s));
    await settle();
    expect(changed).toMatchObject({ title: 'Érett körte', chordpro: input.chordpro });
    expect(store.waiting[0].input.title).toBe('Érett körte');
    // The change is tried at once - still no server.
    http.expectOne({ method: 'POST', url: songs }).flush('', noNetwork);
    await settle();
    expect(store.waiting).toHaveLength(1);

    let deleted = false;
    service.deleteSong(id).subscribe(() => (deleted = true));
    await settle();
    expect(deleted).toBe(true);
    expect(store.waiting).toEqual([]);
    let gone: { status?: number } | undefined;
    service.getSong(id).subscribe({ error: (e) => (gone = e) });
    await settle();
    expect(gone?.status).toBe(404);
  });

  it('is sent once the server answers - the oldest first, and only one’s own', async () => {
    const { service, http, store } = setUp(null, [
      { localId: 'local-other', userId: 'u2', input, savedAt: 'a' },
      { localId: 'local-1', userId: 'u1', input, savedAt: 'b' },
      { localId: 'local-2', userId: 'u1', input: { ...input, title: 'Szilva' }, savedAt: 'c' },
    ]);
    logIn(http);
    service.songs.set([]);
    const sending = service.sendWaiting();
    void service.sendWaiting(); // already on its way
    await settle();
    const first = http.expectOne({ method: 'POST', url: songs });
    expect(first.request.body).toEqual(input);
    first.flush({ data: { song: { _id: 's1', slug: 'korte' } } });
    await settle();
    const second = http.expectOne({ method: 'POST', url: songs });
    expect(second.request.body.title).toBe('Szilva');
    second.flush({ data: { song: { _id: 's2', slug: 'szilva' } } });
    await sending;

    // Somebody else's stays for them.
    expect(store.waiting.map((s) => s.localId)).toEqual(['local-other']);
    expect(service.lastSent()).toEqual({ sent: 2, refused: 0 });
    expect(service.waitingCount()).toBe(0);
    // The list is read again, as the server has it now.
    http.expectOne(songs).flush({ data: { songs: [], canEdit: false, lastChanged: 'y' } });
    // Its old address leads to the song the server made of it.
    service.getSong('local-1').subscribe();
    http.expectOne(`${songs}/korte`).flush({ data: { song: {} } });
  });

  it('stops while the server is out of reach, and keeps a refused one to be corrected', async () => {
    const { service, http, store } = setUp(null, [
      { localId: 'local-1', userId: 'u1', input, savedAt: 'a' },
      { localId: 'local-2', userId: 'u1', input, savedAt: 'b' },
    ]);
    logIn(http);
    let sending = service.sendWaiting();
    await settle();
    http.expectOne({ method: 'POST', url: songs }).flush('', noNetwork);
    await sending;
    expect(store.waiting).toHaveLength(2);
    expect(service.lastSent()).toBeNull();

    sending = service.sendWaiting();
    await settle();
    http
      .expectOne({ method: 'POST', url: songs })
      .flush({ message: 'Nem jó.' }, { status: 400, statusText: 'Bad' });
    await settle();
    http.expectOne({ method: 'POST', url: songs }).flush({ data: { song: { slug: 'x' } } });
    await sending;
    expect(store.waiting).toMatchObject([{ localId: 'local-1', error: 'Nem jó.' }]);
    expect(service.lastSent()).toEqual({ sent: 1, refused: 1 });

    // Refused: not tried again by itself...
    await service.sendWaiting();
    http.expectNone({ method: 'POST', url: songs });
    service.songs.set([]);
    TestBed.tick();
    expect(service.songs()?.[0]).toMatchObject({ waiting: true, refused: 'Nem jó.' });
    // ...but once it is corrected.
    service.updateSong('local-1', { title: 'Jó' }).subscribe();
    await settle();
    http.expectOne({ method: 'POST', url: songs }).flush({ data: { song: { slug: 'jo' } } });
    await settle();
    expect(store.waiting).toEqual([]);
  });
});

describe('SongStore', () => {
  it('keeps nothing, quietly, where there is no IndexedDB', async () => {
    const store = new SongStore();
    expect(store.available).toBe(false);
    expect(await store.read()).toBeNull();
    expect(await store.write(book())).toBe(false);
    await store.clear();
    expect(await store.readWaiting()).toEqual([]);
    expect(await store.writeWaiting([])).toBe(false);
  });
});

describe('OfflineService', () => {
  it('follows the connection, and starts the service worker once', () => {
    const register = vi.fn().mockRejectedValue(new Error('not here'));
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
    const service = TestBed.inject(OfflineService);
    expect(service.isOffline()).toBe(false);
    service.start();
    service.start();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    window.dispatchEvent(new Event('offline'));
    expect(service.isOffline()).toBe(true);
    window.dispatchEvent(new Event('online'));
    expect(service.isOffline()).toBe(false);
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });
});
