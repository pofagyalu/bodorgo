import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { API } from '../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../testing/component';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { Song, SongService } from '../../services/song';
import { ViewTrackerService } from '../../services/view-tracker';
import { AnnexPage } from './annex/annex';
import { ChordDiagram } from './chord-diagram/chord-diagram';
import { chordShape } from './chord-shapes';
import { Daloskonyv } from './daloskonyv';
import { SongEdit } from './song-edit/song-edit';
import { SongSheet } from './song-sheet/song-sheet';
import { SongPage } from './song/song';
import { Tuner } from './tuner/tuner';

const songs = `${API}/songs`;
const CHORDPRO =
  '{soc}\n[C]Tavaszi [G]szél vizet [C]áraszt\n{eoc}\n{comment: megjegyzés}\nvirágom, [Am]virágom';

const song = (over: Partial<Song> = {}): Song => ({
  _id: 's2',
  title: 'Tavaszi szél',
  artist: 'Népdal',
  slug: 'tavaszi-szel',
  chordpro: CHORDPRO,
  tags: [],
  originalKey: '',
  tempo: null,
  key: '',
  detectedKey: 'C',
  inBook: true,
  ownerName: '',
  canEdit: true,
  updatedAt: '2026-01-01',
  ...over,
});
// s1: its key set by hand; s2: the one its chords say; s3: no chords.
const LIST = [
  {
    _id: 's1',
    title: 'Álmodj, királylány',
    artist: 'Zorán',
    slug: 'almodj',
    key: 'am',
    detectedKey: 'C',
    inBook: true,
    ownerName: '',
    canEdit: true,
  },
  {
    _id: 's2',
    title: 'Tavaszi szél',
    artist: 'Népdal',
    slug: 'tavaszi-szel',
    key: '',
    detectedKey: 'C',
    inBook: true,
    ownerName: '',
    canEdit: true,
  },
  {
    _id: 's3',
    title: 'Zöld erdőben',
    artist: 'Népdal',
    slug: 'zold-erdoben',
    key: '',
    detectedKey: '',
    inBook: true,
    ownerName: '',
    canEdit: true,
  },
];

let http: HttpTestingController;
let success: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function setUp(route: object) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [pageTesting(), { provide: ActivatedRoute, useValue: route }],
  });
  http = TestBed.inject(HttpTestingController);
  const notifications = TestBed.inject(NotificationsService);
  success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
  error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SongPage', () => {
  let fixture: ComponentFixture<SongPage>;
  let page: SongPage;
  let slug: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function open(reply: object = { data: { song: song() } }) {
    slug = new BehaviorSubject(convertToParamMap({ slug: 'tavaszi-szel' }));
    setUp({ paramMap: slug });
    TestBed.inject(SongService).songs.set(LIST);
    fixture = TestBed.createComponent(SongPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /songs/tavaszi-szel': reply });
    fixture.detectChanges();
  }

  it('counts the song as a view once it has been open 10 seconds', () => {
    vi.useFakeTimers();
    const seen = vi.spyOn(ViewTrackerService.prototype, 'seen');
    open();
    vi.advanceTimersByTime(9_000);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(seen).toHaveBeenCalledExactlyOnceWith({ type: 'song', key: page.song()!._id });
    seen.mockRestore();
    vi.useRealTimers();
  });

  it('shows the song with its neighbours in the list', () => {
    open();
    expect(page.song()?.title).toBe('Tavaszi szél');
    expect(page.previous()?.slug).toBe('almodj');
    expect(page.next()?.slug).toBe('zold-erdoben');
    expect(fixture.nativeElement.textContent).toContain('vizet');
  });

  it('turns to the next or the previous song with a sideways stroke of a finger', () => {
    open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const sheet: HTMLElement = fixture.nativeElement.querySelector('.sheet');
    // What moves: the track - the sheet, and the other song's beside it.
    const track: HTMLElement = fixture.nativeElement.querySelector('.sheet-track');
    Object.defineProperty(track, 'offsetWidth', { value: 360 });
    const at = (p: [number, number]) => ({ clientX: p[0], clientY: p[1] });
    const event = (touches: object[], timeStamp: number) =>
      ({ touches, timeStamp, target: sheet, currentTarget: sheet }) as never;
    /** A finger put down at one point, moved to another and lifted, this much later. */
    const stroke = (from: [number, number], to: [number, number], ms = 200, fingers = 1) => {
      page.swipeStart(event(Array(fingers).fill(at(from)), 1000));
      page.swipeMove(event(Array(fingers).fill(at(to)), 1000 + ms / 2));
      const pulled = track.style.transform;
      const beside = page.peek() && [page.peek()!.slug, page.peek()!.side];
      page.swipeEnd(event([], 1000 + ms));
      return [pulled, beside];
    };

    // The sheet follows the finger, the other song beside it on the side it
    // comes from; let go far enough, the page turns.
    expect(stroke([300, 400], [150, 410], 600)).toEqual([
      'translateX(-150px)',
      ['zold-erdoben', 1],
    ]); // to the left
    expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', 'zold-erdoben']);
    expect(stroke([100, 400], [260, 380], 600)[1]).toEqual(['almodj', -1]); // to the right
    expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', 'almodj']);
    // A quick flick does too, short as it is.
    navigate.mockClear();
    stroke([300, 400], [250, 400], 150);
    expect(navigate).toHaveBeenCalledTimes(1);

    // Not a page turn: too short and slow, scrolling down, two fingers -
    // the sheet is back in its place.
    navigate.mockClear();
    stroke([300, 400], [250, 400], 600);
    expect(track.style.transform).toBe('');
    expect(page.peek()).toBeNull();
    expect(stroke([300, 400], [280, 600])).toEqual(['', null]);
    expect(stroke([300, 400], [100, 400], 200, 2)).toEqual(['', null]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('pulled towards a side with no song, the sheet barely follows and stays', () => {
    open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const service = TestBed.inject(SongService);
    // The open song is the last of the list.
    service.songs.set(LIST.slice(0, 2));
    const sheet: HTMLElement = fixture.nativeElement.querySelector('.sheet');
    const event = (touches: object[], timeStamp: number) =>
      ({ touches, timeStamp, target: sheet, currentTarget: sheet }) as never;
    page.swipeStart(event([{ clientX: 300, clientY: 400 }], 1000));
    page.swipeMove(event([{ clientX: 100, clientY: 400 }], 1100));
    const track: HTMLElement = fixture.nativeElement.querySelector('.sheet-track');
    expect(track.style.transform).toBe('translateX(-60px)');
    expect(page.peek()).toBeNull();
    page.swipeEnd(event([], 1200));
    expect(navigate).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    service.songs.set(LIST);
  });

  it('fetches the neighbours ahead, so turning to one shows it at once', () => {
    open();
    const ahead = http.match((r) => /\/songs\/(almodj|zold-erdoben)$/.test(r.url));
    expect(ahead).toHaveLength(2);
    ahead
      .find((r) => r.request.url.endsWith('zold-erdoben'))!
      .flush({ data: { song: song({ _id: 's3', slug: 'zold-erdoben', title: 'Zöld erdőben' }) } });

    slug.next(convertToParamMap({ slug: 'zold-erdoben' }));
    fixture.detectChanges();
    // Shown without waiting - and asked for again, in case it has changed.
    expect(page.song()?._id).toBe('s3');
    http
      .expectOne((r) => r.url.endsWith('/songs/zold-erdoben'))
      .flush({ data: { song: song({ _id: 's3', slug: 'zold-erdoben', title: 'Zöld erdő' }) } });
    expect(page.song()?.title).toBe('Zöld erdő');
  });

  it('jumps to a song picked by chance - never this one, never one played tonight', () => {
    open();
    const service = TestBed.inject(SongService);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.random-song');
    expect(button.disabled).toBe(false);

    // The open song is "tavaszi-szel": whatever chance says, one of the other two.
    const chance = vi.spyOn(Math, 'random');
    chance.mockReturnValue(0);
    button.click();
    expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', 'almodj']);
    chance.mockReturnValue(0.999);
    button.click();
    expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', 'zold-erdoben']);

    // Any song of the book, whatever the list is narrowed to - and the
    // narrowing is let go, so the pick shows in the list too.
    service.search.set('tavasz');
    service.artist.set('Népdal');
    chance.mockReturnValue(0);
    button.click();
    expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', 'almodj']); // Zorán's
    expect(service.search()).toBe('');
    expect(service.artist()).toBe('');

    // One of them was played tonight: only the other is left.
    service.setPlayed('s1', true);
    chance.mockReturnValue(0);
    button.click();
    expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', 'zold-erdoben']);

    // Both played: nothing to pick, the button is idle.
    service.setPlayed('s3', true);
    fixture.detectChanges();
    expect(page.canPickRandom()).toBe(false);
    expect(button.disabled).toBe(true);
    navigate.mockClear();
    page.randomSong();
    expect(navigate).not.toHaveBeenCalled();

    chance.mockRestore();
    service.clearPlayed();
  });

  it('follows the chosen playlist: its order for the neighbours, its songs for the random pick', () => {
    open();
    const service = TestBed.inject(SongService);
    // A list of mine with the three songs turned around: s3, s2, s1.
    service.lists.set([{ _id: 'l1', name: 'Esti dalok', songs: ['s3', 's2', 's1'] }]);
    service.chooseList('l1');
    fixture.detectChanges();
    // The open song is s2 (tavaszi-szel): before it now the list's first.
    expect(page.previous()?.slug).toBe('zold-erdoben');
    expect(page.next()?.slug).toBe('almodj');

    // A list without the open song: the book's own order serves it.
    service.lists.set([{ _id: 'l1', name: 'Esti dalok', songs: ['s3'] }]);
    fixture.detectChanges();
    expect(page.previous()?.slug).toBe('almodj');
    expect(page.next()?.slug).toBe('zold-erdoben');
    // The random pick stays in the list - and the list stays chosen.
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    page.randomSong();
    expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', 'zold-erdoben']);
    expect(service.listId()).toBe('l1');
    // Its one song played: nothing left to pick there.
    service.setPlayed('s3', true);
    expect(page.canPickRandom()).toBe(false);

    service.clearPlayed();
    service.chooseList('');
  });

  it('puts the open song into a playlist of mine, or takes it out, from a panel', () => {
    open();
    const service = TestBed.inject(SongService);
    const el: HTMLElement = fixture.nativeElement;
    const button = el.querySelector('.list-tool > button') as HTMLButtonElement;
    expect(el.querySelector('.list-menu')).toBeNull();

    // No list yet: the panel says where to make one.
    service.lists.set([]);
    button.click();
    fixture.detectChanges();
    expect(el.querySelector('.list-menu-empty')?.textContent).toContain('Még nincs listád');

    service.lists.set([
      { _id: 'l1', name: 'Esti dalok', songs: ['s2'] },
      { _id: 'l2', name: 'Tábortűz', songs: [] },
    ]);
    fixture.detectChanges();
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('.list-menu-item')];
    // The open song (s2) is in the first list, not in the second.
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false']);

    items()[1].click();
    const added = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/songs/lists/l2'));
    expect(added.request.body).toEqual({ songs: ['s2'] });
    added.flush({ data: { list: { _id: 'l2', name: 'Tábortűz', songs: ['s2'] } } });
    items()[0].click();
    const removed = http.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/songs/lists/l1'),
    );
    expect(removed.request.body).toEqual({ songs: [] });
    removed.flush({ data: { list: { _id: 'l1', name: 'Esti dalok', songs: [] } } });
    fixture.detectChanges();
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  it('keeps the tools behind one button for a phone - one panel open at a time', () => {
    open();
    const service = TestBed.inject(SongService);
    service.lists.set([]);
    const el: HTMLElement = fixture.nativeElement;
    const panel = el.querySelector('.tools-panel') as HTMLElement;
    const controls = el.querySelector('.song-bar .controls-btn') as HTMLButtonElement;
    const tap = (target: HTMLElement) => {
      target.click();
      fixture.detectChanges();
    };
    // Every tool but the playlists' is in the panel; that one stands beside
    // the controls' button.
    expect(panel.querySelector('.played-toggle')).toBeTruthy();
    expect(panel.querySelector('.list-tool')).toBeNull();
    expect(panel.classList).not.toContain('tools-panel--open');

    tap(controls);
    expect(panel.classList).toContain('tools-panel--open');
    expect(controls.getAttribute('aria-expanded')).toBe('true');
    // The playlists' panel takes its place, and the other way round.
    tap(el.querySelector('.list-tool > button') as HTMLElement);
    expect(panel.classList).not.toContain('tools-panel--open');
    expect(el.querySelector('.list-menu')).toBeTruthy();
    tap(controls);
    expect(el.querySelector('.list-menu')).toBeNull();

    // What is set with one tap closes the panel: the instrument, the chord
    // diagrams, the played mark. The letters' size is tapped again and again.
    tap(panel.querySelector('[aria-label="Nagyobb betűk"]') as HTMLElement);
    expect(page.controlsOpen()).toBe(true);
    tap(panel.querySelector('.tool--choice button') as HTMLElement);
    expect(page.controlsOpen()).toBe(false);
    tap(controls);
    tap(panel.querySelector('.tool--diagrams button') as HTMLElement);
    expect(page.controlsOpen()).toBe(false);
    // Undo, so the choice doesn't stay for the tests after.
    page.toggleDiagrams();

    // The played mark shows in the song's head as well, while it is set.
    expect(el.querySelector('.song-head .song-played')).toBeNull();
    tap(controls);
    tap(panel.querySelector('.played-toggle') as HTMLElement);
    expect(page.controlsOpen()).toBe(false);
    expect(el.querySelector('.song-head .song-played')).toBeTruthy();
    service.clearPlayed();
    fixture.detectChanges();
    expect(el.querySelector('.song-head .song-played')).toBeNull();
  });

  it('shows the tempo of a song that has one, and beats it on a tap', () => {
    vi.useFakeTimers();
    try {
      open({ data: { song: song({ tempo: 120 }) } });
      const tag: HTMLButtonElement = fixture.nativeElement.querySelector('.song-tempo');
      expect(tag.textContent).toContain('= 120');

      tag.click();
      expect(page.beating()).toBe(true);
      expect(page.beatOn()).toBe(true); // the first beat at once
      vi.advanceTimersByTime(200);
      expect(page.beatOn()).toBe(false);
      vi.advanceTimersByTime(300);
      expect(page.beatOn()).toBe(true); // half a second on: the second beat

      // A second tap stops it.
      tag.click();
      expect(page.beating()).toBe(false);
      expect(page.beatOn()).toBe(false);

      // Left alone it stops by itself after a few bars.
      tag.click();
      vi.advanceTimersByTime(20000);
      expect(page.beating()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('narrows the song list to the artist on a tap on the name', () => {
    open();
    const service = TestBed.inject(SongService);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const media = vi.spyOn(window, 'matchMedia');
    const name: HTMLButtonElement = fixture.nativeElement.querySelector('.artist-name');
    expect(name.textContent?.trim()).toBe('Népdal');

    // The list is beside the song: it narrows there, the song stays.
    media.mockReturnValue({ matches: false } as MediaQueryList);
    service.search.set('valami');
    name.click();
    expect(service.artist()).toBe('Népdal');
    expect(service.search()).toBe('');
    expect(navigate).not.toHaveBeenCalled();

    // A phone, where the song has the list's place: back to the list.
    media.mockReturnValue({ matches: true } as MediaQueryList);
    name.click();
    expect(navigate).toHaveBeenCalledWith(['/daloskonyv']);
    media.mockRestore();
    service.artist.set('');
  });

  it('shows no tempo where none was given', () => {
    open();
    expect(fixture.nativeElement.querySelector('.song-tempo')).toBeNull();
  });

  it('says so when there is no such song', () => {
    open(fail(404));
    expect(page.notFound()).toBe(true);
    expect(page.song()).toBeNull();
    expect(page.isPlayed()).toBe(false);
    page.togglePlayed(); // nothing to mark
  });

  it('loads the other song when the address changes, starting from the original key again', () => {
    open();
    page.changeTranspose(2);
    slug.next(convertToParamMap({ slug: 'zold-erdoben' }));
    fixture.detectChanges();
    // The open song stays until the other one is here - no empty page.
    expect(page.song()?._id).toBe('s2');
    expect(page.transpose()).toBe(0);
    respond({
      'GET /songs/zold-erdoben': { data: { song: song({ _id: 's3', slug: 'zold-erdoben' }) } },
    });
    expect(page.song()?._id).toBe('s3');
    expect(page.next()).toBeNull();
  });

  it('remembers the font size, kept within its steps', () => {
    open();
    expect(page.fontScale()).toBe(1);
    page.changeFont(1);
    expect(page.fontScale()).toBe(1.15);
    expect(localStorage.getItem('daloskonyv-font')).toBe('2');
    for (let i = 0; i < 10; i++) page.changeFont(1);
    expect(page.fontScale()).toBe(1.75);
    for (let i = 0; i < 10; i++) page.changeFont(-1);
    expect(page.fontScale()).toBe(0.85);
  });

  it('remembers the instrument and whether the chord diagrams are shown', () => {
    open();
    expect(page.showDiagrams()).toBe(true);
    page.toggleDiagrams();
    expect(localStorage.getItem('daloskonyv-diagrams')).toBe('false');
    page.chooseInstrument('ukulele');
    expect(page.instrument()).toBe('ukulele');
  });

  it('marks the song as played, and back', () => {
    open();
    page.togglePlayed();
    expect(page.isPlayed()).toBe(true);
    page.togglePlayed();
    expect(page.isPlayed()).toBe(false);
  });

  it('transposes by semitones, around the octave', () => {
    open();
    page.changeTranspose(1);
    expect(page.transposeLabel()).toBe('+1');
    page.changeTranspose(-3);
    expect(page.transposeLabel()).toBe('-2');
    for (let i = 0; i < 14; i++) page.changeTranspose(1);
    expect(page.transpose()).toBe(0);
  });

  it('offers the original key of a song that was saved transposed', () => {
    open({ data: { song: song({ originalKey: 'D' }) } });
    expect(page.originalKey()).toEqual({ chord: 'D', steps: 2 });
    page.showOriginalKey();
    expect(page.transpose()).toBe(2);

    TestBed.resetTestingModule();
    open({ data: { song: song({ originalKey: 'C' }) } }); // already in it
    expect(page.originalKey()).toBeNull();
    page.showOriginalKey();
    expect(page.transpose()).toBe(0);
  });

  it('has no save button and no pencil on a song that is someone else’s', () => {
    open({ data: { song: song({ canEdit: false, inBook: false, ownerName: 'Melinda' }) } });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.keep-key')).toBeNull();
    expect(el.querySelector('a[aria-label="A dal szerkesztése"]')).toBeNull();
    // Its PDF is everyone's.
    expect(el.querySelector('a.song-pdf')).toBeTruthy();
  });

  it('keeps the save button in its place on one’s own song - idle until the song is moved', () => {
    open();
    const keep = () => fixture.nativeElement.querySelector('.keep-key') as HTMLButtonElement | null;
    expect(fixture.nativeElement.querySelector('a[aria-label="A dal szerkesztése"]')).toBeTruthy();
    expect(keep()?.disabled).toBe(true);
    expect(keep()?.classList).toContain('keep-key--idle');

    page.changeTranspose(1);
    fixture.detectChanges();
    expect(keep()?.disabled).toBe(false);
    expect(keep()?.classList).not.toContain('keep-key--idle');

    // Back at 0 it is idle again, still there.
    page.transpose.set(0);
    fixture.detectChanges();
    expect(keep()?.disabled).toBe(true);
  });

  it('lets the keeper take someone else’s song into the book, after a yes', async () => {
    const theirs = song({ inBook: false, ownerName: 'Melinda' });
    open({ data: { song: theirs } });
    const button = () =>
      fixture.nativeElement.querySelector('button.take-in') as HTMLButtonElement | null;
    // Not the keeper: no such button.
    expect(button()).toBeNull();

    TestBed.inject(SongService).canEdit.set(true);
    fixture.detectChanges();
    const confirm = TestBed.inject(ConfirmService);
    button()!.click();
    expect(confirm.pending()?.detail).toContain('Melinda többé nem tudja szerkeszteni');
    confirm.answer(false);
    await Promise.resolve();
    http.expectNone((r) => r.method === 'PATCH');

    const taking = page.takeIntoBook();
    confirm.answer(true);
    await taking;
    const req = http.expectOne((r) => r.method === 'PATCH');
    expect(req.request.body).toEqual({ inBook: true });
    req.flush({ data: { song: song({ inBook: true, ownerName: '' }) } });
    http.expectOne((r) => r.url === songs && r.method === 'GET'); // the list follows
    fixture.detectChanges();
    expect(success).toHaveBeenCalledWith('A dal bekerült a daloskönyvbe.');
    // In the book now: nothing left to take in.
    expect(button()).toBeNull();
  });

  it('has no take-in button on a song of the book', () => {
    open();
    TestBed.inject(SongService).canEdit.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button.take-in')).toBeNull();
  });

  it('saves the song in the transposed key after a yes', async () => {
    open();
    const confirm = TestBed.inject(ConfirmService);
    await page.saveTransposed(); // not transposed: nothing to save
    expect(confirm.pending()).toBeNull();

    page.changeTranspose(2);
    let saving = page.saveTransposed();
    expect(confirm.pending()?.message).toContain('+2 félhang');
    confirm.answer(false);
    await saving;
    http.expectNone((r) => r.method === 'PATCH');

    saving = page.saveTransposed();
    confirm.answer(true);
    await saving;
    const req = http.expectOne(`${songs}/s2`);
    expect(req.request.body.originalKey).toBe('C');
    expect(req.request.body.chordpro).toContain('[D]Tavaszi [A]szél');
    // No key set by hand: the new chords will say the new key.
    expect(req.request.body.key).toBe('');
    void page.saveTransposed(); // already saving
    req.flush({ data: { song: song({ chordpro: req.request.body.chordpro, originalKey: 'C' }) } });
    expect(page.transpose()).toBe(0);
    expect(page.originalKey()).toEqual({ chord: 'C', steps: -2 }); // the way back
    expect(success).toHaveBeenCalledWith('A dal ebben a hangnemben elmentve.');

    page.changeTranspose(1);
    saving = page.saveTransposed();
    confirm.answer(true);
    await saving;
    respond({ 'PATCH /songs/s2': fail(403, 'Nincs jogod.') });
    expect(error).toHaveBeenCalledWith('Nincs jogod.');
    expect(page.savingKey()).toBe(false);
  });

  it('shows the song’s key after the artist, moved with the transposing', () => {
    open();
    const tag = () => fixture.nativeElement.querySelector('.artist .song-key')?.textContent?.trim();
    // What the chords say.
    expect(page.keyLabel()).toBe('C-dúr');
    expect(page.keySetByHand()).toBe(false);
    expect(tag()).toBe('C-dúr');
    page.changeTranspose(2);
    fixture.detectChanges();
    expect(tag()).toBe('D-dúr');
    page.changeTranspose(-3);
    fixture.detectChanges();
    expect(tag()).toBe('H-dúr');
  });

  it('shows a key set by hand rather than the one the chords say - and moves it when saving', async () => {
    open({ data: { song: song({ key: 'am' }) } });
    expect(page.keyLabel()).toBe('a-moll');
    expect(page.keySetByHand()).toBe(true);

    page.changeTranspose(2);
    expect(page.keyLabel()).toBe('h-moll');
    const saving = page.saveTransposed();
    TestBed.inject(ConfirmService).answer(true);
    await saving;
    const req = http.expectOne(`${songs}/s2`);
    // The key set by hand goes with the song.
    expect(req.request.body.key).toBe('hm');
    req.flush({ data: { song: song({ chordpro: req.request.body.chordpro, key: 'hm' }) } });
    expect(page.keyLabel()).toBe('h-moll');
  });

  it('shows no key for a song without chords', () => {
    open({ data: { song: song({ chordpro: 'csak szöveg', detectedKey: '' }) } });
    expect(page.keyLabel()).toBe('');
    expect(fixture.nativeElement.querySelector('.song-key')).toBeNull();
  });

  it('offers the song alone as a PDF, the way it is on the screen', () => {
    open();
    const link = () =>
      fixture.nativeElement.querySelector('a.song-pdf')?.getAttribute('href') as string;
    // The chords over the song are shown: the chosen instrument's go along.
    expect(link()).toBe(`${songs}/tavaszi-szel/pdf?diagrams=guitar&download=1`);

    page.changeTranspose(-2);
    page.chooseInstrument('ukulele');
    fixture.detectChanges();
    expect(link()).toBe(`${songs}/tavaszi-szel/pdf?diagrams=ukulele&transpose=-2&download=1`);

    page.toggleDiagrams();
    page.changeTranspose(2);
    fixture.detectChanges();
    expect(link()).toBe(`${songs}/tavaszi-szel/pdf?download=1`);
  });

  describe('scrolling by itself', () => {
    let scroller: HTMLElement;
    const step = (now: number) => (page as unknown as { step(now: number): void }).step(now);

    /** Puts the page in a scrollable .page-body, as the app shell does. */
    function scrollable(scrollHeight = 2000, clientHeight = 500) {
      scroller = document.createElement('div');
      scroller.className = 'page-body';
      document.body.appendChild(scroller);
      scroller.appendChild(fixture.nativeElement);
      let top = 0;
      Object.defineProperties(scroller, {
        scrollHeight: { value: scrollHeight },
        clientHeight: { value: clientHeight },
        scrollTop: {
          get: () => top,
          set: (v: number) => (top = Math.min(v, scrollHeight - clientHeight)),
        },
      });
    }

    afterEach(() => scroller?.remove());

    it('has nowhere to scroll outside the app shell', () => {
      open();
      page.play();
      expect(page.pace()).toBe(0);
    });

    it('counts down, then scrolls at the chosen pace and marks the song played at the end', () => {
      vi.useFakeTimers();
      open();
      scrollable();
      expect(page.playLabel()).toContain('Lejátszás');
      page.play();
      expect(page.pace()).toBe(1);
      expect(page.countdown()).toBe(3);
      expect(page.arrows()).toHaveLength(1);
      vi.advanceTimersByTime(3000);
      expect(page.countdown()).toBe(0);

      step(1000); // the first frame only notes the time
      step(1100);
      expect(scroller.scrollTop).toBeCloseTo(0.6 * 16 * 0.1); // 0.6 rem/s for 0.1 s
      page.play(); // again: faster
      expect(page.pace()).toBe(2);
      expect(page.playLabel()).toBe('Gyorsabb görgetés');
      expect(JSON.parse(localStorage.getItem('daloskonyv-pace')!)).toEqual({ 'tavaszi-szel': 2 });
      page.play();
      page.play(); // after the fastest comes the slowest
      expect(page.pace()).toBe(1);

      // nearly at the bottom now
      (page as unknown as { position: number }).position = 1499.5;
      step(1200);
      step(1300);
      expect(page.pace()).toBe(0); // stopped at the bottom
      expect(page.isPlayed()).toBe(true);
    });

    it('waits while the reader scrolls by hand', () => {
      vi.useFakeTimers();
      open();
      scrollable();
      page.play();
      vi.advanceTimersByTime(3000);
      step(1000);
      scroller.dispatchEvent(new Event('touchstart'));
      scroller.scrollTop = 300;
      step(1100);
      expect(scroller.scrollTop).toBe(300); // not moved by the page
      scroller.dispatchEvent(new Event('touchend'));
      scroller.dispatchEvent(new Event('wheel'));
      page.stop();
      expect(page.pace()).toBe(0);
      step(1200); // a late frame after stopping does nothing
    });

    it('starts at the pace remembered for this song', () => {
      vi.useFakeTimers();
      open();
      scrollable();
      localStorage.setItem('daloskonyv-pace', JSON.stringify({ 'tavaszi-szel': 3 }));
      page.play();
      expect(page.pace()).toBe(3);
      expect(page.arrows()).toHaveLength(3);
      fixture.destroy(); // leaving the page stops it
    });
  });
});

describe('SongEdit', () => {
  let fixture: ComponentFixture<SongEdit>;
  let page: SongEdit;
  let navigate: ReturnType<typeof vi.spyOn>;
  let box: HTMLTextAreaElement;

  function open(slug: string | null, reply: object = { data: { song: song() } }) {
    setUp({ snapshot: { paramMap: convertToParamMap(slug ? { slug } : {}) } });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(SongEdit);
    page = fixture.componentInstance;
    fixture.detectChanges();
    if (slug) respond({ [`GET /songs/${slug}`]: reply });
    fixture.detectChanges();
    box = fixture.nativeElement.querySelector('textarea');
  }

  /** Puts a text in the editor with a selection (or just the caret). */
  function select(text: string, start: number, end = start) {
    box.value = text;
    box.setSelectionRange(start, end);
  }

  it('fills the form from the song', () => {
    open('tavaszi-szel');
    expect(page.isNew).toBe(false);
    expect(page.loading()).toBe(false);
    expect(page.title()).toBe('Tavaszi szél');
    expect(page.chordpro()).toBe(CHORDPRO);
    expect(page.backLink()).toEqual(['/daloskonyv', 'tavaszi-szel']);
  });

  it('goes back to the list when there is no such song', () => {
    open('nincs', fail(404));
    expect(error).toHaveBeenCalledWith('Nincs ilyen dal a daloskönyvben.');
    expect(navigate).toHaveBeenCalledWith(['/daloskonyv']);
  });

  it('doesn’t open someone else’s song for editing', () => {
    open('tavaszi-szel', { data: { song: song({ canEdit: false, ownerName: 'Melinda' }) } });
    expect(error).toHaveBeenCalledWith('Ezt a dalt csak az módosíthatja, aki felvette.');
    expect(navigate).toHaveBeenCalledWith(['/daloskonyv', 'tavaszi-szel']);
    expect(page.song()).toBeNull();
  });

  it('puts a chord at the caret and wraps a selection as chorus', () => {
    open(null);
    expect(page.backLink()).toEqual(['/daloskonyv']);
    select('Tavaszi szél', 8);
    page.addChord();
    expect(page.chordpro()).toBe('Tavaszi []szél');
    expect(box.selectionStart).toBe(9); // inside the brackets, ready to type

    select('első sor\nmásodik sor', 0, 8);
    page.markChorus();
    expect(page.chordpro()).toBe('{start_of_chorus}\nelső sor\n{end_of_chorus}\nmásodik sor');
  });

  it('marks repeats and screen-only chords from the buttons over the text', () => {
    open(null);
    const press = (label: string) => {
      const button = [...fixture.nativeElement.querySelectorAll('.text-tools button')].find((b) =>
        (b as HTMLElement).textContent?.includes(label),
      ) as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
    };

    // Made-up words; the caret in the second verse's first line.
    select('első sor\n\nmásik vers\nvége', 12);
    press('Ismétlés');
    expect(page.chordpro()).toBe('első sor\n\n||: másik vers :||\nvége');
    expect(box.value).toBe(page.chordpro());
    press('Ismétlés');
    expect(page.chordpro()).toBe('első sor\n\nmásik vers\nvége');

    box.setSelectionRange(12, 12);
    press('Csak képernyőn');
    // Standing alone: an empty line above it and one under it.
    expect(page.chordpro()).toBe('első sor\n\n{screen}\n\nmásik vers\nvége');
    expect(box.value).toBe(page.chordpro());
    press('Csak képernyőn');
    expect(page.chordpro()).toBe('első sor\n\nmásik vers\nvége');
  });

  it('turns a pasted song with chords over its words into ChordPro', () => {
    open(null);
    const paste = (text: string) =>
      ({
        clipboardData: { getData: () => text },
        preventDefault: vi.fn(),
      }) as unknown as ClipboardEvent;

    // Made-up words; the chords come the international way.
    select('Cím\n\nvége', 4); // on the empty line
    const song = paste('Am   Bm\r\nKint a réten');
    page.onPaste(song);
    expect(song.preventDefault).toHaveBeenCalled();
    expect(page.chordpro()).toBe('Cím\n[am]Kint [hm]a réten\nvége');
    expect(success).toHaveBeenCalledWith(
      'Az akkordok a szövegbe kerültek. Ctrl+Z: vissza a másolt szöveghez.',
    );

    // Plain words, and ChordPro, are the browser's to paste.
    const plain = paste('Kint a réten');
    page.onPaste(plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    const ready = paste('[am]Kint a [F]réten');
    page.onPaste(ready);
    expect(ready.preventDefault).not.toHaveBeenCalled();
  });

  it('nudges the chord under the caret with Alt+arrows', () => {
    open(null);
    const key = (k: string, altKey = true) =>
      ({ key: k, altKey, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
    select('Ta[C]vaszi', 3);
    page.onKeydown(key('ArrowRight'));
    expect(page.chordpro()).toBe('Tav[C]aszi');
    page.onKeydown(key('ArrowLeft'));
    expect(page.chordpro()).toBe('Ta[C]vaszi');

    const plain = key('ArrowLeft', false);
    page.onKeydown(plain); // without Alt it is an ordinary arrow
    page.onKeydown(key('a'));
    expect(plain.preventDefault).not.toHaveBeenCalled();

    select('nincs akkord', 3);
    page.nudge(1); // nothing to move
    expect(page.chordpro()).toBe('Ta[C]vaszi');
  });

  it('needs a title, then creates the song and opens it', () => {
    open(null);
    expect(page.isNew).toBe(true);
    page.save();
    expect(error).toHaveBeenCalledWith('A dalnak kell legyen címe.');

    page.title.set(' Új dal ');
    page.subtitle.set(' egy filmből ');
    page.artist.set(' Valaki ');
    page.chordpro.set('[C]la');
    // The preview shows the subtitle under the title.
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.preview .subtitle').textContent).toBe(
      'egy filmből',
    );
    page.save();
    const req = http.expectOne((r) => r.url === songs && r.method === 'POST');
    expect(req.request.body).toEqual({
      title: 'Új dal',
      subtitle: 'egy filmből',
      artist: 'Valaki',
      chordpro: '[C]la',
      key: '',
      tempo: null,
    });
    req.flush({ data: { song: song({ slug: 'uj-dal' }) } });
    expect(success).toHaveBeenCalledWith('A dal elmentve.');
    expect(navigate).toHaveBeenCalledWith(['/daloskonyv', 'uj-dal']);
    http.expectOne((r) => r.url === songs && r.method === 'GET'); // the list is reloaded
  });

  it('leaves the checks to the app, so a refused save always says why', () => {
    open(null);
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form.editor');
    // The browser's own checks would stop the save without a word.
    expect(form.noValidate).toBe(true);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(error).toHaveBeenCalledWith('A dalnak kell legyen címe.');
    http.expectNone((r) => r.method === 'POST');
  });

  it('takes the tempo typed or tapped, and saves it with the song', () => {
    open('tavaszi-szel', { data: { song: song({ tempo: 96 }) } });
    expect(page.tempoText()).toBe('96');

    // Not a tempo: nothing is sent.
    page.tempoText.set('500');
    page.save();
    expect(error).toHaveBeenCalledWith('A tempó 30 és 300 közötti egész szám lehet.');
    http.expectNone((r) => r.method === 'PATCH');

    // Tapped half a second apart: 120.
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    page.tapTempo();
    expect(page.tempoText()).toBe('500'); // one tap says nothing yet
    now.mockReturnValue(1500);
    page.tapTempo();
    expect(page.tempoText()).toBe('120');
    now.mockRestore();

    page.save();
    const req = http.expectOne((r) => r.method === 'PATCH');
    expect(req.request.body.tempo).toBe(120);
    req.flush({ data: { song: song({ tempo: 120 }) } });
    http.expectOne((r) => r.url === songs && r.method === 'GET');
  });

  it('saves an existing song, and reports a refused save', () => {
    open('tavaszi-szel');
    page.title.set('Tavaszi szél vizet áraszt');
    page.save();
    const req = http.expectOne(`${songs}/s2`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ message: 'Van már ilyen című dal.' }, { status: 400, statusText: 'x' });
    expect(error).toHaveBeenCalledWith('Van már ilyen című dal.');
    expect(page.saving()).toBe(false);
  });

  it('works the key out from the chords as they are typed', () => {
    open(null);
    expect(page.detectedKey()).toBe('');
    expect(page.previewKey()).toBe('');
    page.chordpro.set('[am]la [dm]la [E]la [am]la');
    expect(page.detectedKey()).toBe('a-moll');
    expect(page.previewKey()).toBe('a-moll');
    expect(page.key()).toBe('');
    fixture.detectChanges();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('.field--key select');
    expect(select.options[0].textContent?.trim()).toBe('automatikus (a-moll)');
    expect(select.options).toHaveLength(25);
  });

  it('keeps a key chosen by hand only until a chord is changed', () => {
    open('tavaszi-szel', { data: { song: song({ key: 'am' }) } });
    // The song's own: it holds for the chords it came with.
    expect(page.key()).toBe('am');
    expect(page.previewKey()).toBe('a-moll');

    // The words change, the chords don't: it stays.
    page.chordpro.set(CHORDPRO.replace('vizet', 'esőt'));
    expect(page.key()).toBe('am');
    // A chord changes: the key is worked out again.
    page.chordpro.set(CHORDPRO.replace('[G]', '[G7]'));
    expect(page.key()).toBe('');
    expect(page.previewKey()).toBe('C-dúr');
    // Chosen again, for these chords.
    page.chooseKey('G');
    expect(page.key()).toBe('G');
    page.save();
    const req = http.expectOne(`${songs}/s2`);
    expect(req.request.body.key).toBe('G');
    req.flush({ data: { song: song({ key: 'G' }) } });
    http.expectOne((r) => r.url === songs && r.method === 'GET');

    // Back to automatic.
    page.chooseKey('');
    expect(page.key()).toBe('');
  });

  it('deletes the song only after a yes', async () => {
    open('tavaszi-szel');
    const confirm = TestBed.inject(ConfirmService);
    let deleting = page.delete();
    expect(confirm.pending()?.message).toContain('„Tavaszi szél”');
    confirm.answer(false);
    await deleting;
    http.expectNone((r) => r.method === 'DELETE');

    deleting = page.delete();
    confirm.answer(true);
    await deleting;
    respond({ 'DELETE /songs/s2': fail() });
    expect(error).toHaveBeenCalledWith('A dalt nem sikerült törölni.');

    deleting = page.delete();
    confirm.answer(true);
    await deleting;
    respond({ 'DELETE /songs/s2': {} });
    expect(success).toHaveBeenCalledWith('A dal törölve.');
    expect(navigate).toHaveBeenCalledWith(['/daloskonyv']);
  });

  it('has nothing to delete on a new song', async () => {
    open(null);
    await page.delete();
    expect(TestBed.inject(ConfirmService).pending()).toBeNull();
  });
});

describe('Daloskonyv', () => {
  let fixture: ComponentFixture<Daloskonyv>;
  let page: Daloskonyv;

  function open(child: Record<string, string> | null = null) {
    setUp({ firstChild: child && { snapshot: { paramMap: convertToParamMap(child) } } });
    fixture = TestBed.createComponent(Daloskonyv);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /songs': { data: { songs: LIST, canEdit: true, lastChanged: 'x' } } });
    fixture.detectChanges();
  }

  describe("the search's keys", () => {
    const input = () => fixture.nativeElement.querySelector('.search input') as HTMLInputElement;
    const marked = () =>
      [...fixture.nativeElement.querySelectorAll('.song-list li a.highlighted')].map(
        (a: HTMLAnchorElement) => a.id,
      );
    const type = (text: string) => {
      input().value = text;
      input().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const press = (key: string) => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key }));
      fixture.detectChanges();
    };

    it('marks the first song found, moves with ↓/↑ and opens the marked one with Enter', () => {
      open();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      // Nothing typed: nothing marked, Enter does nothing.
      press('Enter');
      expect(marked()).toEqual([]);
      expect(navigate).not.toHaveBeenCalled();

      type('e'); // in more than one title
      const hits = page.found().map((f) => f.song.slug);
      expect(hits.length).toBeGreaterThan(1);
      expect(marked()).toEqual(['song-hit-0']);
      expect(input().getAttribute('aria-activedescendant')).toBe('song-hit-0');

      press('ArrowDown');
      expect(marked()).toEqual(['song-hit-1']);
      press('ArrowUp');
      press('ArrowUp'); // no further than the first
      expect(marked()).toEqual(['song-hit-0']);
      for (let i = 0; i < hits.length + 2; i++) press('ArrowDown'); // nor past the last
      expect(marked()).toEqual([`song-hit-${hits.length - 1}`]);

      press('Enter');
      expect(navigate).toHaveBeenLastCalledWith(['/daloskonyv', hits.at(-1)]);

      // Typing on starts from the first again.
      type('er');
      expect(marked()).toEqual(['song-hit-0']);
    });
  });

  describe('playlists', () => {
    // Two lists of mine; made-up names. s1 Álmodj…, s2 Tavaszi szél, s3 Zöld erdőben.
    const MY_LISTS = [
      { _id: 'l1', name: 'Esti dalok', songs: ['s3', 's1'] },
      { _id: 'l2', name: 'Üres lista', songs: [] },
    ];
    const el = () => fixture.nativeElement as HTMLElement;
    const titles = () => page.filtered().map((s) => s.slug);

    function openWithLists() {
      open();
      respond({ 'GET /songs/lists': { data: { lists: MY_LISTS } } });
      fixture.detectChanges();
    }

    it('offers every list in a panel, and shows the chosen one in its own order', () => {
      openWithLists();
      // The selector: a round icon at the end of the first row - no row of
      // its own, and with the whole book nothing more than that.
      const firstRow = el().querySelector('.tools-row') as HTMLElement;
      const button = firstRow.querySelector('.list-btn') as HTMLButtonElement;
      expect(button.classList).not.toContain('list-btn--on');
      expect(button.querySelector('.list-count')).toBeNull();
      expect(el().querySelector('.list-panel')).toBeNull();
      expect(el().querySelector('.list-active')).toBeNull();

      button.click();
      fixture.detectChanges();
      const options = [...firstRow.querySelectorAll<HTMLButtonElement>('.list-option')];
      expect(options.map((o) => o.querySelector('span')?.textContent)).toEqual([
        'Minden dal',
        'Esti dalok',
        'Üres lista',
      ]);

      options[1].click();
      fixture.detectChanges();
      expect(el().querySelector('.list-panel')).toBeNull();
      // Chosen: the button filled, with the number of the list's songs -
      // and a line with its name and what is done with it.
      expect(button.classList).toContain('list-btn--on');
      expect(button.querySelector('.list-count')?.textContent?.trim()).toBe('2');
      expect(el().querySelector('.list-tag')?.textContent).toContain('Esti dalok');
      // The list's own order, not the alphabet's - and no letters over it.
      expect(titles()).toEqual(['zold-erdoben', 'almodj']);
      expect(el().querySelector('.letter-head')).toBeNull();
      expect(el().querySelector('.list-actions')).toBeTruthy();
      // Remembered on the device.
      expect(localStorage.getItem('daloskonyv-list')).toBe('l1');

      // Back to the whole book: a tap on the list's name.
      (el().querySelector('.list-tag') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(page.playlist()).toBeNull();
      expect(el().querySelector('.list-active')).toBeNull();
      expect(titles()).toHaveLength(3);
      expect(el().querySelector('.letter-head')).toBeTruthy();
    });

    it('ticks songs into the list and out of it while picking', () => {
      openWithLists();
      page.chooseList('l1');
      page.togglePicking();
      fixture.detectChanges();
      // The whole book to pick from, each row with a box.
      expect(titles()).toHaveLength(3);
      const rows = [...el().querySelectorAll<HTMLAnchorElement>('.song-list li a')];
      expect(rows.map((a) => a.classList.contains('picked'))).toEqual([true, false, true]);

      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
      // A tap on a song that isn't in the list: in, at its end - and the
      // song isn't opened.
      rows[1].click();
      fixture.detectChanges();
      expect(navigate).not.toHaveBeenCalled();
      const added = http.expectOne(
        (r) => r.method === 'PATCH' && r.url.endsWith('/songs/lists/l1'),
      );
      expect(added.request.body).toEqual({ songs: ['s3', 's1', 's2'] });
      added.flush({ data: { list: { ...MY_LISTS[0], songs: ['s3', 's1', 's2'] } } });
      // A tap on one that is: out.
      rows[0].click();
      const removed = http.expectOne((r) => r.method === 'PATCH');
      expect(removed.request.body).toEqual({ songs: ['s3', 's2'] });
      removed.flush({ data: { list: { ...MY_LISTS[0], songs: ['s3', 's2'] } } });

      // Done picking: the list as it is now.
      page.togglePicking();
      fixture.detectChanges();
      expect(titles()).toEqual(['zold-erdoben', 'tavaszi-szel']);
    });

    it('creates a list and goes straight to filling it; an empty list says how', () => {
      openWithLists();
      page.chooseList('l2');
      fixture.detectChanges();
      expect(el().querySelector('.list-note')?.textContent).toContain('még nincs dal');

      page.listsOpen.set(true);
      fixture.detectChanges();
      // A new list's name, typed into the selector's panel (playlist-picker).
      const form = el().querySelector('.tools-row .list-new') as HTMLFormElement;
      const name = form.querySelector('input') as HTMLInputElement;
      name.value = '  Tábortűz ';
      name.dispatchEvent(new Event('input'));
      form.dispatchEvent(new Event('submit'));
      const created = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/songs/lists'));
      expect(created.request.body).toEqual({ name: 'Tábortűz' });
      created.flush({ data: { list: { _id: 'l3', name: 'Tábortűz', songs: [] } } });
      fixture.detectChanges();
      expect(page.playlist()?.name).toBe('Tábortűz');
      expect(page.picking()).toBe(true);
      expect(page.listsOpen()).toBe(false);
      // By name among the others.
      expect(page.lists()?.map((l) => l.name)).toEqual(['Esti dalok', 'Tábortűz', 'Üres lista']);
    });

    it('reorders, renames and deletes the chosen list', async () => {
      openWithLists();
      page.chooseList('l1');
      page.search.set('valami');
      page.toggleOrdering();
      fixture.detectChanges();
      // Ordering goes by the whole list: the search is let go.
      expect(page.search()).toBe('');
      expect(el().querySelectorAll('.drag-handle')).toHaveLength(2);

      page.moveSong({ previousIndex: 0, currentIndex: 1 } as never);
      const moved = http.expectOne((r) => r.method === 'PATCH');
      expect(moved.request.body).toEqual({ songs: ['s1', 's3'] });
      moved.flush({ data: { list: { ...MY_LISTS[0], songs: ['s1', 's3'] } } });
      expect(titles()).toEqual(['almodj', 'zold-erdoben']);

      page.startRenaming();
      page.renaming.set(' Éjszakai dalok ');
      page.rename();
      const renamed = http.expectOne((r) => r.method === 'PATCH');
      expect(renamed.request.body).toEqual({ name: 'Éjszakai dalok' });
      renamed.flush({ data: { list: { _id: 'l1', name: 'Éjszakai dalok', songs: ['s1', 's3'] } } });
      expect(page.playlist()?.name).toBe('Éjszakai dalok');
      expect(page.renaming()).toBeNull();

      const confirm = TestBed.inject(ConfirmService);
      const deleting = page.deleteList();
      expect(confirm.pending()?.message).toContain('Éjszakai dalok');
      confirm.answer(true);
      await deleting;
      http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/songs/lists/l1')).flush(null);
      // Back on the whole book, the list gone.
      expect(page.playlist()).toBeNull();
      expect(page.lists()?.map((l) => l._id)).toEqual(['l2']);
      expect(titles()).toHaveLength(3);
    });
  });

  it('keeps the controls behind one button for a phone, the playlists’ selector beside it', () => {
    open();
    const el: HTMLElement = fixture.nativeElement;
    const row = el.querySelector('.tools-row') as HTMLElement;
    const button = el.querySelector('.top-row .controls-btn') as HTMLButtonElement;
    // Away until called (the phone's styles hide the row meanwhile).
    expect(row.classList).not.toContain('tools-row--open');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // The playlists' selector stands in the search's row too, always at hand.
    expect(el.querySelector('.top-row .top-row-phone .list-btn')).toBeTruthy();

    button.click();
    fixture.detectChanges();
    expect(row.classList).toContain('tools-row--open');
    expect(button.classList).toContain('on');
    button.click();
    fixture.detectChanges();
    expect(row.classList).not.toContain('tools-row--open');

    // One panel at a time: the playlists' closes the controls', and the
    // other way round.
    button.click();
    (el.querySelector('.top-row-phone .list-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(row.classList).not.toContain('tools-row--open');
    expect(page.listsOpen()).toBe(true);
    button.click();
    fixture.detectChanges();
    expect(page.listsOpen()).toBe(false);
    expect(row.classList).toContain('tools-row--open');
    button.click();
    fixture.detectChanges();

    // The guests' page stands on its own: it keeps its heading on a phone.
    // Inside Média the menu says where one is.
    expect(el.querySelector('.book')!.classList).not.toContain('book--in-media');
    expect(page.inMedia()).toBe(false);
  });

  it('has the instrument, the PDF and the played marks in one row, the search under it', () => {
    open();
    const el: HTMLElement = fixture.nativeElement;
    const first = el.querySelector('.tools-row')!;
    expect(first.querySelector('.instrument')).toBeTruthy();
    expect(first.querySelector('a.book-btn')).toBeTruthy();
    const second = el.querySelector('.top-row')!;
    expect(second.querySelector('.search')).toBeTruthy();
    expect(second.querySelector('.new-song-btn')).toBeTruthy();
    expect(second.querySelector('.book-btn')).toBeNull();

    // The played marks' button: an icon, idle while nothing is marked.
    const clear = first.querySelector('button.clear-played') as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    expect(clear.title).toBe('Ma még egy dal sincs megjelölve');
    expect(clear.querySelector('.clear-count')).toBeNull();

    const service = TestBed.inject(SongService);
    service.setPlayed('s1', true);
    service.setPlayed('s3', true);
    fixture.detectChanges();
    expect(clear.disabled).toBe(false);
    expect(clear.title).toBe('Játszottak jelölésének törlése (2)');
    expect(clear.querySelector('.clear-count')?.textContent?.trim()).toBe('2');

    clear.click();
    fixture.detectChanges();
    expect(service.played().size).toBe(0);
    expect(clear.disabled).toBe(true);
  });

  it('puts a letter of the alphabet over the first song under it', () => {
    setUp({ firstChild: null });
    fixture = TestBed.createComponent(Daloskonyv);
    page = fixture.componentInstance;
    fixture.detectChanges();
    // In the book's order; made-up titles.
    const titled = (id: string, title: string) => ({ ...LIST[0], _id: id, slug: id, title });
    respond({
      'GET /songs': {
        data: {
          songs: [
            titled('n1', '67-es út'),
            titled('a1', 'Alma'),
            titled('a2', 'Álom'),
            titled('c1', 'Cica'),
            titled('c2', 'Csak'),
            titled('o1', 'Óra'),
            titled('o2', 'Öröm'),
          ],
          canEdit: false,
          lastChanged: 'x',
        },
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    // What stands in the list, top to bottom: headings and titles.
    const rows = () =>
      [...el.querySelectorAll('.songs > .song-list > li')].map((li) =>
        li.classList.contains('letter-head')
          ? `[${li.textContent?.trim()}]`
          : li.querySelector('strong')?.textContent?.trim(),
      );
    // No heading over the number; Á with A; Cs and Ö letters of their own.
    expect(rows()).toEqual([
      '67-es út',
      '[A]',
      'Alma',
      'Álom',
      '[C]',
      'Cica',
      '[Cs]',
      'Csak',
      '[O]',
      'Óra',
      '[Ö]',
      'Öröm',
    ]);
    // To look at, not to press.
    expect(el.querySelector('.letter-head a, .letter-head button')).toBeNull();

    // A search lists what it finds by how well it fits: no headings then.
    page.search.set('a');
    fixture.detectChanges();
    expect(el.querySelector('.letter-head')).toBeNull();
    page.search.set('');
  });

  it('has the played marks’ button among the tuner’s and the annexes’ icons too', () => {
    open();
    const el: HTMLElement = fixture.nativeElement;
    const row = el.querySelector('.annex-row')!;
    // The three icons, then the played marks' button, the playlists'
    // selector and "+ Dal" (the styles show those three there only beside
    // an open song).
    expect(row.querySelectorAll(':scope > li')).toHaveLength(6);
    expect(row.querySelector('.annex-row-clear .list-btn')).toBeTruthy();
    const add = row.querySelector('.annex-row-clear a.annex-row-new') as HTMLAnchorElement;
    expect(add.getAttribute('href')).toBe('/daloskonyv/uj');
    expect(add.title).toBe('Új dal');
    const inRow = row.querySelector('.annex-row-clear button.clear-played') as HTMLButtonElement;
    expect(inRow.disabled).toBe(true);

    const service = TestBed.inject(SongService);
    service.setPlayed('s2', true);
    fixture.detectChanges();
    expect(inRow.disabled).toBe(false);
    expect(inRow.querySelector('.clear-count')?.textContent?.trim()).toBe('1');
    inRow.click();
    fixture.detectChanges();
    expect(service.played().size).toBe(0);

    // A search that leaves none of the three: on the list's own page the
    // row goes (its first row has the button).
    page.search.set('zzz');
    fixture.detectChanges();
    expect(el.querySelector('.annex-row')).toBeNull();
    page.search.set('');
  });

  it('lists the songs and the annexes', () => {
    open();
    expect(page.filtered()).toHaveLength(3);
    expect(page.annexes().map((a) => a.id)).toEqual(['hangolo', 'kvintkor', 'akkordtablazat']);
    expect(page.canEdit()).toBe(true);
    expect(page.isOpen()).toBe(false);
    expect(page.bookUrl()).toBe(`${songs}/book.pdf?diagrams=guitar&download=1`);
  });

  it('narrows the list to one artist, with the way back to everyone', () => {
    open();
    const service = TestBed.inject(SongService);
    const tag = () => fixture.nativeElement.querySelector('.artist-filter') as HTMLElement | null;
    expect(tag()).toBeNull();

    service.artist.set('Népdal');
    fixture.detectChanges();
    expect(page.filtered().map((s) => s.slug)).toEqual(['tavaszi-szel', 'zold-erdoben']);
    // The pages that aren't songs are no artist's.
    expect(page.annexes()).toEqual([]);
    expect(tag()?.textContent).toContain('Előadó: Népdal');

    // The search works within the artist's songs.
    page.search.set('zöld');
    expect(page.filtered().map((s) => s.slug)).toEqual(['zold-erdoben']);
    page.search.set('');

    // A name that is only part of an artist's isn't that artist.
    service.artist.set('Nép');
    expect(page.filtered()).toEqual([]);

    service.artist.set('Zorán');
    fixture.detectChanges();
    tag()!.click();
    fixture.detectChanges();
    expect(service.artist()).toBe('');
    expect(page.filtered()).toHaveLength(3);
    expect(page.annexes()).toHaveLength(3);
    expect(tag()).toBeNull();
  });

  it('lets everyone add a song, and shows whose a song is that isn’t the book’s own', () => {
    setUp({ firstChild: null });
    fixture = TestBed.createComponent(Daloskonyv);
    page = fixture.componentInstance;
    fixture.detectChanges();
    // Not the keeper; one song was added by someone else, beside the book.
    // It came since the last visit here: the server says it is new.
    const theirs = {
      ...LIST[2],
      inBook: false,
      ownerName: 'Melinda',
      canEdit: false,
      isNew: true,
    };
    respond({
      'GET /songs': {
        data: { songs: [LIST[0], LIST[1], theirs], canEdit: false, lastChanged: 'x' },
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(page.canEdit()).toBe(false);
    expect(el.querySelector('.new-song-btn')).toBeTruthy();
    const tags = [...el.querySelectorAll('.owner-tag')].map((t) => t.textContent?.trim());
    expect(tags).toEqual(['Melinda']);
    // "Új" on that row alone.
    const fresh = [...el.querySelectorAll('.song-list li')].filter((li) =>
      li.querySelector('.new-tag'),
    );
    expect(fresh.map((li) => li.querySelector('strong')?.textContent?.trim())).toEqual([
      LIST[2].title,
    ]);
    // The book counts its own songs only.
    expect(TestBed.inject(SongService).bookSongs()).toHaveLength(2);
  });

  it('marks what is searched for in the titles and the artists', () => {
    open();
    const marks = () =>
      [...fixture.nativeElement.querySelectorAll('.song-name mark')].map((m) => m.textContent);
    expect(marks()).toEqual([]);

    // In a title, accents aside.
    page.search.set('zold');
    fixture.detectChanges();
    expect(marks()).toEqual(['Zöld']);
    // In the artists' names: both songs of the artist.
    page.search.set('népdal');
    fixture.detectChanges();
    expect(marks()).toEqual(['Népdal', 'Népdal']);
    page.search.set('');
  });

  it('has the alphabet beside the list - a letter brings its first song to the top', () => {
    open();
    const el: HTMLElement = fixture.nativeElement;
    const letters = [...el.querySelectorAll<HTMLButtonElement>('.letters button')];
    expect(letters.map((b) => b.textContent?.trim()).slice(0, 3)).toEqual(['#', 'A', 'B']);
    expect(letters).toHaveLength(27);
    // The list's titles start with Á, T and Z: only those letters lead somewhere.
    expect(letters.filter((b) => !b.disabled).map((b) => b.textContent?.trim())).toEqual([
      'A',
      'T',
      'Z',
    ]);
    // The first row of each letter carries it.
    const marked = [...el.querySelectorAll('.song-list li[data-letter]')];
    expect(marked.map((li) => li.getAttribute('data-letter'))).toEqual(['A', 'T', 'Z']);

    const list = el.querySelector('.songs > .song-list') as HTMLElement;
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
    letters.find((b) => b.textContent?.trim() === 'T')!.click();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    // A letter without songs does nothing.
    page.jumpTo('Q');
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('searches the songs’ words too, and shows the line that was found', () => {
    open();
    // The words arrive once the list is there.
    respond({
      'GET /songs/lyrics': {
        data: {
          lyrics: [
            { _id: 's1', lines: ['Álmodj, királylány', 'Kinn a téren csend van'] },
            { _id: 's2', lines: ['Tavaszi szél vizet áraszt', 'Minden madár társat választ'] },
          ],
        },
      },
    });
    page.search.set('MADAR');
    expect(page.found().map((f) => [f.song.slug, f.line?.match])).toEqual([
      ['tavaszi-szel', 'madár'],
    ]);
    fixture.detectChanges();
    const line: HTMLElement = fixture.nativeElement.querySelector('.song-list .found-line');
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe('Minden madár társat választ');
    expect(line.querySelector('mark')?.textContent).toBe('madár');

    // A title's match comes first and shows no line.
    page.search.set('tavaszi');
    expect(page.found().map((f) => [f.song.slug, f.line])).toEqual([['tavaszi-szel', null]]);
    page.search.set('csend');
    expect(page.filtered().map((s) => s.slug)).toEqual(['almodj']);
  });

  it('counts a search of the whole book that finds nothing - once the typing has stopped', () => {
    vi.useFakeTimers();
    const seen = vi.spyOn(ViewTrackerService.prototype, 'seen');
    open();
    respond({ 'GET /songs/lyrics': { data: { lyrics: [{ _id: 's1', lines: ['Álmodj'] }] } } });
    page.search.set('Szép kék');
    fixture.detectChanges();
    vi.advanceTimersByTime(1_000);
    page.search.set('Szép kék ég');
    fixture.detectChanges();
    vi.advanceTimersByTime(1_999);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(seen).toHaveBeenCalledExactlyOnceWith({ type: 'search', key: 'szep kek eg' });
    // One that finds a song isn't counted, nor one too short.
    for (const words of ['álmodj', 'xy']) {
      page.search.set(words);
      fixture.detectChanges();
      vi.advanceTimersByTime(5_000);
    }
    expect(seen).toHaveBeenCalledTimes(1);
    seen.mockRestore();
    vi.useRealTimers();
  });

  it('shows each song’s key at its row’s end', () => {
    open();
    // Set by hand; what the chords say; none for a song without chords.
    expect(LIST.map((s) => page.keyOf(s))).toEqual(['a-moll', 'C-dúr', '']);
    const tags = [...fixture.nativeElement.querySelectorAll('.song-list .song-key')].map((t) =>
      t.textContent?.trim(),
    );
    expect(tags).toEqual(['a-moll', 'C-dúr']);
  });

  it('searches titles, artists and annexes, ignoring accents and case', () => {
    open();
    page.search.set('ZOLD');
    expect(page.filtered().map((s) => s.slug)).toEqual(['zold-erdoben']);
    page.search.set('népdal');
    expect(page.filtered()).toHaveLength(2);
    page.search.set('tuner');
    expect(page.filtered()).toEqual([]);
    expect(page.annexes().map((a) => a.id)).toEqual(['hangolo']);
  });

  it('knows which song or annex is open beside the list', () => {
    open({ slug: 'almodj' });
    expect(page.openSlug()).toBe('almodj');
    expect(page.isOpen()).toBe(true);
    TestBed.resetTestingModule();
    open({ annex: 'kvintkor' });
    expect(page.openAnnex()).toBe('kvintkor');
  });

  it('changes the instrument and clears the played marks', () => {
    open();
    const service = TestBed.inject(SongService);
    service.setPlayed('s1', true);
    expect(page.played().size).toBe(1);
    page.clearPlayed();
    expect(page.played().size).toBe(0);
    page.chooseInstrument('ukulele');
    expect(page.bookUrl()).toContain('diagrams=ukulele');
  });
});

describe('SongSheet', () => {
  let fixture: ComponentFixture<SongSheet>;
  let sheet: SongSheet;
  const mouse = (target: HTMLElement) =>
    ({ pointerType: 'mouse', currentTarget: target }) as unknown as PointerEvent;

  beforeEach(() => {
    setUp({});
    fixture = TestBed.createComponent(SongSheet);
    sheet = fixture.componentInstance;
    fixture.componentRef.setInput('chordpro', CHORDPRO);
    fixture.componentRef.setInput('instrument', 'guitar');
    fixture.detectChanges();
  });

  it('lays the song out in blocks, the chorus marked', () => {
    const blocks = sheet.blocks();
    expect(blocks[0].chorus).toBe(true);
    expect(blocks[0].lines[0].hasChords).toBe(true);
    const chords = blocks[0].lines[0].words
      .flat()
      .map((s) => s.chord)
      .filter(Boolean);
    expect(chords).toEqual(['C', 'G', 'C']);
    const comment = blocks.flatMap((b) => b.lines).find((l) => l.type === 'comment');
    expect(comment?.text).toBe('megjegyzés');
    expect(fixture.nativeElement.textContent).toContain('virágom');
  });

  it('transposes every chord', () => {
    fixture.componentRef.setInput('transpose', 2);
    const chords = sheet
      .blocks()
      .flatMap((b) => b.lines)
      .flatMap((l) => l.words.flat())
      .map((s) => s.chord)
      .filter(Boolean);
    expect(chords).toEqual(['D', 'A', 'D', 'Hm']); // Hungarian notation: H, not B
  });

  it('marks a line of labels or chords without words, so no empty line stands under it', () => {
    fixture.componentRef.setInput('chordpro', '[Chorus]\n[C]Tavaszi [G]szél\n[C] [G]');
    fixture.detectChanges();
    const lines = [...fixture.nativeElement.querySelectorAll('.lyrics .line')] as HTMLElement[];
    expect(lines.map((l) => l.classList.contains('line--chords-only'))).toEqual([
      true,
      false,
      true,
    ]);
    // The label is one of the song's lines, in the verse it stands over.
    expect(sheet.blocks()).toHaveLength(1);
    expect(lines[0].querySelector('.chord--label')?.textContent?.trim()).toBe('Chorus');
  });

  it('writes a chord’s numbers as indexes - over the lyrics and over its diagram', () => {
    fixture.componentRef.setInput('chordpro', '[F7]Tavaszi [Gsus2]szél [am]vizet [2x]áraszt');
    fixture.componentRef.setInput('showDiagrams', true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const raised = (selector: string) =>
      [...root.querySelectorAll(`${selector} sup`)].map((s) => s.textContent?.trim());
    expect(raised('.lyrics .chord')).toEqual(['7', '2']);
    // The whole name is still there to read: F7, Gsus2 - and "2x" is no chord.
    const names = [...root.querySelectorAll('.lyrics .chord')].map((c) =>
      c.textContent?.replace(/\s+/g, ''),
    );
    expect(names).toEqual(['F7', 'Gsus2', 'am', '2x']);
    expect(raised('.diagrams figcaption')).toEqual(['7', '2']);
  });

  it('shows a diagram for each different chord when asked', () => {
    expect(sheet.diagrams()).toEqual([]);
    fixture.componentRef.setInput('showDiagrams', true);
    expect(sheet.diagrams().map((d) => d.name)).toEqual(['C', 'G', 'Am']);
    expect(sheet.diagrams()[0].shape).not.toBeNull();
    fixture.componentRef.setInput('instrument', null);
    expect(sheet.diagrams()).toEqual([]);
  });

  it('tells chords from other bracketed labels', () => {
    expect(sheet.isChord('Am7')).toBe(true);
    expect(sheet.isChord('Intro')).toBe(false);
  });

  it('shows the fingering while hovering a chord, and keeps it open after a tap', () => {
    const chord = document.createElement('span');
    sheet.onEnter({ ...mouse(chord), pointerType: 'touch' } as PointerEvent, 'C');
    expect(sheet.popup()).toBeNull();

    sheet.onEnter(mouse(chord), 'C');
    expect(sheet.popup()).toMatchObject({ name: 'C', pinned: false, top: 8 });
    sheet.onLeave(mouse(chord));
    expect(sheet.popup()).toBeNull();

    const tap = { stopPropagation: vi.fn(), currentTarget: chord } as unknown as Event;
    sheet.onTap(tap, 'G');
    expect(sheet.popup()).toMatchObject({ name: 'G', pinned: true });
    sheet.onEnter(mouse(chord), 'C'); // a pinned one stays
    sheet.onLeave(mouse(chord));
    expect(sheet.popup()?.name).toBe('G');
    sheet.onTap(tap, 'G'); // a second tap closes it
    expect(sheet.popup()).toBeNull();
  });

  it('opens the fingering above the chord when there is room', () => {
    const chord = document.createElement('span');
    vi.spyOn(chord, 'getBoundingClientRect').mockReturnValue({
      top: 400,
      bottom: 420,
      left: 100,
      width: 20,
    } as DOMRect);
    sheet.onEnter(mouse(chord), 'C');
    expect(sheet.popup()).toMatchObject({ top: 242, left: 48 });
  });

  it('closes the fingering on a click elsewhere or a scroll, and has none for unknown chords', () => {
    const chord = document.createElement('span');
    sheet.onEnter(mouse(chord), 'C');
    document.dispatchEvent(new Event('click'));
    expect(sheet.popup()).toBeNull();
    sheet.onEnter(mouse(chord), 'C');
    window.dispatchEvent(new Event('scroll'));
    expect(sheet.popup()).toBeNull();

    sheet.onEnter(mouse(chord), 'Intro');
    expect(sheet.popup()).toBeNull();
    fixture.componentRef.setInput('instrument', null);
    sheet.onEnter(mouse(chord), 'C');
    expect(sheet.popup()).toBeNull();
  });
});

describe('ChordDiagram', () => {
  function view(name: string, instrument: 'guitar' | 'ukulele' = 'guitar') {
    setUp({});
    const fixture = TestBed.createComponent(ChordDiagram);
    fixture.componentRef.setInput('name', name);
    fixture.componentRef.setInput('shape', chordShape(name, instrument));
    fixture.detectChanges();
    return fixture.componentInstance.view();
  }

  it('draws an open chord from the nut, with its open and muted strings', () => {
    const c = view('C')!;
    expect(c.nut).toBe(true);
    expect(c.baseLabel).toBeNull();
    expect(c.stringLines).toHaveLength(6);
    expect(c.dots).toHaveLength(3);
    expect(c.open.length).toBeGreaterThan(0);
    expect(c.muted).toHaveLength(1);
    expect(c.barre).toBeFalsy();
  });

  it('draws a barre as one bar instead of separate dots', () => {
    const f = view('F')!;
    expect(f.barre).toBeTruthy();
    expect(f.dots.length).toBeLessThan(6);
  });

  it('draws four strings for the ukulele, and nothing without a shape', () => {
    expect(view('C', 'ukulele')!.stringLines).toHaveLength(4);
    TestBed.resetTestingModule();
    setUp({});
    const fixture = TestBed.createComponent(ChordDiagram);
    fixture.componentRef.setInput('name', '?');
    fixture.componentRef.setInput('shape', null);
    fixture.detectChanges();
    expect(fixture.componentInstance.view()).toBeNull();
  });

  it('labels the fret when the shape sits higher up the neck', () => {
    setUp({});
    const fixture = TestBed.createComponent(ChordDiagram);
    fixture.componentRef.setInput('name', 'x');
    fixture.componentRef.setInput('shape', {
      frets: [-1, 7, 9, 9, 8, 7],
      barre: { fret: 7, from: 1, to: 5 },
    });
    fixture.detectChanges();
    const v = fixture.componentInstance.view()!;
    expect(v.nut).toBe(false);
    expect(v.baseLabel?.text).toBe('7.');
    expect(v.dots).toHaveLength(3);
  });
});

describe('AnnexPage', () => {
  function open(annex: string) {
    setUp({ paramMap: new BehaviorSubject(convertToParamMap({ annex })) });
    logIn({ role: 'member' });
    const fixture = TestBed.createComponent(AnnexPage);
    fixture.detectChanges();
    return fixture;
  }

  it.each(['hangolo', 'kvintkor', 'akkordtablazat'])('shows the "%s" annex', (id) => {
    const fixture = open(id);
    expect(fixture.componentInstance.annex()?.id).toBe(id);
    expect(fixture.nativeElement.textContent.length).toBeGreaterThan(20);
  });

  it('has nothing for an unknown annex, and changes the instrument', () => {
    const page = open('nincs').componentInstance;
    expect(page.annex()).toBeNull();
    expect(page.base()).toBe('/media/zene/daloskonyv');
    page.chooseInstrument('ukulele');
    expect(page.instrument()).toBe('ukulele');
  });
});

describe('Tuner', () => {
  let fixture: ComponentFixture<Tuner>;
  let tuner: Tuner;
  let samples: (buffer: Float32Array) => void;
  const listen = (now: number) => (tuner as unknown as { listen(now: number): void }).listen(now);

  /** Fills the buffer with a clean tone of the given frequency. */
  const tone = (frequency: number) => (buffer: Float32Array) => {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = Math.sin((2 * Math.PI * frequency * i) / 44100);
    }
  };
  const silence = (buffer: Float32Array) => buffer.fill(0);

  /** A browser with a microphone that hears whatever `samples` produces. */
  function microphone() {
    const stop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 44100;
        close = close;
        createAnalyser() {
          return {
            fftSize: 0,
            getFloatTimeDomainData: (buffer: Float32Array) => samples(buffer),
          };
        }
        createMediaStreamSource() {
          return { connect: () => {} };
        }
      },
    );
    return { stop, close };
  }

  beforeEach(() => {
    setUp({});
    fixture = TestBed.createComponent(Tuner);
    tuner = fixture.componentInstance;
    fixture.detectChanges();
    samples = silence;
  });

  afterEach(() => delete (navigator as { mediaDevices?: unknown }).mediaDevices);

  it('waits for a string to be plucked', () => {
    expect(tuner.strings()).toHaveLength(6);
    expect(tuner.advice()).toBe('Pengess meg egy húrt…');
    expect(tuner.activeString()).toBe(-1);
    expect(tuner.needle()).toBe(50);
    fixture.componentRef.setInput('instrument', 'ukulele');
    expect(tuner.strings()).toHaveLength(4);
  });

  it('cannot listen without a microphone, or when it is refused', async () => {
    await tuner.start();
    expect(tuner.error()).toContain('nem enged hozzáférni');

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await tuner.start();
    expect(tuner.error()).toContain('nem éri el a mikrofont');
    expect(tuner.listening()).toBe(false);
  });

  it('finds the string that was plucked and says which way to turn', async () => {
    const mic = microphone();
    await tuner.start();
    expect(tuner.listening()).toBe(true);

    samples = tone(110); // the A string, spot on
    listen(100);
    expect(tuner.note()?.midi).toBe(45);
    expect(tuner.strings()[tuner.activeString()].midi).toBe(45);
    expect(tuner.inTune()).toBe(true);
    expect(tuner.advice()).toBe('Tiszta!');

    samples = tone(107); // flat
    for (let i = 0; i < 5; i++) listen(200 + i);
    expect(tuner.inTune()).toBe(false);
    expect(tuner.offset()).toBeLessThan(0);
    expect(tuner.advice()).toBe('Mély – húzd feljebb');
    expect(tuner.needle()).toBeLessThan(50);

    samples = tone(113); // sharp
    for (let i = 0; i < 5; i++) listen(300 + i);
    expect(tuner.advice()).toBe('Magas – engedd lejjebb');

    samples = silence; // the note fades, then goes
    listen(400);
    expect(tuner.faded()).toBe(true);
    expect(tuner.note()).not.toBeNull();
    listen(2000);
    expect(tuner.note()).toBeNull();

    tuner.stop();
    expect(mic.stop).toHaveBeenCalled();
    expect(mic.close).toHaveBeenCalled();
    expect(tuner.listening()).toBe(false);
    listen(3000); // a late frame after stopping does nothing
    await settle();
  });
});
