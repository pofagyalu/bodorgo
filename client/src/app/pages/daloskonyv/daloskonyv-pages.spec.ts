import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { API } from '../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../testing/component';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { Song, SongService } from '../../services/song';
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
  },
  {
    _id: 's2',
    title: 'Tavaszi szél',
    artist: 'Népdal',
    slug: 'tavaszi-szel',
    key: '',
    detectedKey: 'C',
  },
  {
    _id: 's3',
    title: 'Zöld erdőben',
    artist: 'Népdal',
    slug: 'zold-erdoben',
    key: '',
    detectedKey: '',
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

  it('shows the song with its neighbours in the list', () => {
    open();
    expect(page.song()?.title).toBe('Tavaszi szél');
    expect(page.previous()?.slug).toBe('almodj');
    expect(page.next()?.slug).toBe('zold-erdoben');
    expect(fixture.nativeElement.textContent).toContain('vizet');
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
    expect(page.song()).toBeNull();
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

  it('keeps the save button in its place for the owner - idle until the song is moved', () => {
    open();
    const keep = () => fixture.nativeElement.querySelector('.keep-key') as HTMLButtonElement | null;
    // Not the owner: no such button at all.
    expect(keep()).toBeNull();

    TestBed.inject(SongService).canEdit.set(true);
    fixture.detectChanges();
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
    page.artist.set(' Valaki ');
    page.chordpro.set('[C]la');
    page.save();
    const req = http.expectOne((r) => r.url === songs && r.method === 'POST');
    expect(req.request.body).toEqual({
      title: 'Új dal',
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

  it('lists the songs and the annexes', () => {
    open();
    expect(page.filtered()).toHaveLength(3);
    expect(page.annexes().map((a) => a.id)).toEqual(['hangolo', 'kvintkor', 'akkordtablazat']);
    expect(page.canEdit()).toBe(true);
    expect(page.isOpen()).toBe(false);
    expect(page.bookUrl()).toBe(`${songs}/book.pdf?diagrams=guitar&download=1`);
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
