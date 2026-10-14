import { HttpEventType } from '@angular/common/http';
import { API } from '../../../../testing/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import {
  Failure,
  fail,
  pageTesting,
  respond,
  settle,
  waiting,
} from '../../../../testing/component';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { LibraryBookDetails, LibrarySearch, LibraryShelf } from '../../../services/library';
import { Library, printedPage } from './library';
import { LibraryBookPage } from './library-book';

const BOOK = {
  _id: 'b1',
  shelf: 'gitar',
  title: 'Csalamádé 1.',
  subtitle: '',
  author: '',
  pages: 151,
  pageOffset: 2,
  hasText: true,
};
const SCAN_BOOK = { ...BOOK, _id: 'b2', title: 'Szkennelt', pageOffset: 0, hasText: false };
const SHELVES: LibraryShelf[] = [
  { key: 'gitar', title: 'Gitár', books: [BOOK, SCAN_BOOK] },
  { key: 'harmonika', title: 'Harmonika', books: [] },
];
const IDLE = { running: false, done: 0, total: 0, current: null, errors: [] };
const FOUND: LibrarySearch = {
  titles: [],
  contents: [{ book: 'b1', page: 40, title: 'Darabokra törted a szívem' }],
  pages: [
    {
      book: 'b1',
      page: 5,
      snippet: { before: 'Mindenki ', match: 'másképp', after: ' csinálja' },
    },
  ],
  more: false,
  books: { b1: BOOK },
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('printedPage', () => {
  it("gives the book's own number, the PDF's where the book has none", () => {
    expect(printedPage({ pageOffset: 2 }, 5)).toBe('7. oldal');
    expect(printedPage({ pageOffset: -1 }, 1)).toBe('PDF 1. lap');
  });
});

describe('Library', () => {
  let fixture: ComponentFixture<Library>;
  const el = () => fixture.nativeElement as HTMLElement;

  function open(scan = IDLE) {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    fixture = TestBed.createComponent(Library);
    fixture.detectChanges();
    respond({ 'GET /library': { data: { shelves: SHELVES, scan } } });
    fixture.detectChanges();
  }

  it('stands the books on their shelves, a scan without text marked', () => {
    open();
    const shelves = el().querySelectorAll('.shelf');
    expect(shelves.length).toBe(2);
    const spines = shelves[0].querySelectorAll('.spine');
    expect([...spines].map((s) => s.querySelector('.spine-title')?.textContent)).toEqual([
      'Csalamádé 1.',
      'Szkennelt',
    ]);
    expect(spines[0].getAttribute('href')).toBe('/b1');
    expect(spines[0].querySelector('.spine-flag')).toBeNull();
    expect(spines[1].querySelector('.spine-flag')).not.toBeNull();
    expect(shelves[1].querySelector('.empty-shelf')?.textContent).toContain('library/harmonika');
  });

  it('searches a shelf once the typing stops, and fades the books without a hit', () => {
    vi.useFakeTimers();
    open();
    const input = el().querySelector('.shelf .search input') as HTMLInputElement;
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('m'); // too short - nothing is asked
    vi.advanceTimersByTime(400);
    expect(waiting()).toEqual([]);

    type('másképp');
    vi.advanceTimersByTime(400);
    respond({
      'GET /library/search': (req) => {
        expect(req.request.params.get('q')).toBe('másképp');
        expect(req.request.params.get('shelf')).toBe('gitar');
        return { data: FOUND };
      },
    });
    fixture.detectChanges();

    const hits = el().querySelectorAll('.hit');
    expect(hits.length).toBe(2);
    expect(hits[0].textContent).toContain('42. oldal');
    expect(hits[0].getAttribute('href')).toBe('/b1?page=40');
    expect(hits[1].querySelector('mark')?.textContent).toBe('másképp');
    expect(hits[1].textContent).toContain('7. oldal');
    const spines = el().querySelectorAll('.spine');
    expect(spines[0].classList.contains('spine--dim')).toBe(false);
    expect(spines[1].classList.contains('spine--dim')).toBe(true);

    // The box emptied: the hits go, the books are all back.
    (el().querySelector('.search-clear') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('.results')).toBeNull();
    expect(el().querySelector('.spine--dim')).toBeNull();
  });

  it('uploads a PDF to a shelf, showing how far it is, and says why when refused', () => {
    open();
    const http = TestBed.inject(HttpTestingController);
    const input = el().querySelector('.shelf .upload input') as HTMLInputElement;
    const pick = () => {
      const file = new File(['%PDF-'], 'uj.pdf', { type: 'application/pdf' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      return http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/shelves/gitar/books'));
    };
    const label = () => el().querySelector('.shelf .upload')?.textContent?.trim();

    let req = pick();
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    req.event({ type: HttpEventType.UploadProgress, loaded: 42, total: 100 });
    fixture.detectChanges();
    expect(label()).toContain('Feltöltés… 42%');
    req.flush({ data: { scan: { ...IDLE, running: true, total: 1 } } });
    fixture.detectChanges();
    expect(label()).toMatch(/Feltöltés$/);
    expect((el().querySelector('.refresh') as HTMLButtonElement).disabled).toBe(true);

    const errors = vi.spyOn(TestBed.inject(NotificationsService), 'addError');
    req = pick();
    req.flush(
      { message: 'Ezen a polcon már van ilyen nevű könyv.' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(errors).toHaveBeenCalledWith('Ezen a polcon már van ilyen nevű könyv.');
    expect(label()).toMatch(/Feltöltés$/);
    http.match(() => true);
  });

  it('Frissítés starts a scan and looks again until it is over', () => {
    vi.useFakeTimers();
    open();
    const running = { ...IDLE, running: true, total: 2, current: 'gitar/uj.pdf' };
    (el().querySelector('.refresh') as HTMLButtonElement).click();
    respond({ 'POST /library/scan': { data: { scan: running } } });
    fixture.detectChanges();
    expect((el().querySelector('.refresh') as HTMLButtonElement).disabled).toBe(true);

    vi.advanceTimersByTime(1600);
    respond({ 'GET /library': { data: { shelves: SHELVES, scan: running } } });
    fixture.detectChanges();
    expect(el().querySelector('.scan-note')?.textContent).toContain('0 / 2');

    vi.advanceTimersByTime(1600);
    respond({
      'GET /library': {
        data: {
          shelves: SHELVES,
          scan: { ...IDLE, done: 2, total: 2, errors: ['gitar/x.pdf: rossz'] },
        },
      },
    });
    fixture.detectChanges();
    expect((el().querySelector('.refresh') as HTMLButtonElement).disabled).toBe(false);
    expect(el().querySelector('.scan-note--error')?.textContent).toContain('gitar/x.pdf');
    vi.advanceTimersByTime(1600);
    expect(waiting()).toEqual([]);
  });
});

describe('LibraryBookPage', () => {
  let fixture: ComponentFixture<LibraryBookPage>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: ReturnType<typeof vi.spyOn>;
  const el = () => fixture.nativeElement as HTMLElement;
  const DETAILS: LibraryBookDetails = {
    ...BOOK,
    filename: 'csalamade_1.pdf',
    toc: [
      { title: 'Mindenki másképp csinálja', page: 5, level: 0 },
      { title: 'Darabokra törted a szívem', page: 40, level: 0 },
    ],
    tracks: [
      { file: '01 Masképp.mp3', number: 1, title: 'Masképp' },
      { file: '02 Darabokra.mp3', number: 2, title: 'Darabokra' },
    ],
    audioLinks: [
      { file: '01 Masképp.mp3', page: 5 },
      { file: '01 Masképp.mp3', page: 6 },
    ],
  };

  function open(page: string | null, reply: object | Failure = { data: { book: DETAILS } }) {
    query = new BehaviorSubject(convertToParamMap(page ? { page } : {}));
    TestBed.configureTestingModule({
      providers: [
        pageTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ book: 'b1' }) },
            queryParamMap: query,
          },
        },
      ],
    });
    // Turning a page changes the address - here that is the query itself.
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockImplementation(async (_, extras) => {
        query.next(convertToParamMap(extras?.queryParams ?? {}));
        return true;
      });
    fixture = TestBed.createComponent(LibraryBookPage);
    fixture.detectChanges();
    respond({ 'GET /library/books/b1': reply });
    fixture.detectChanges();
  }

  const shown = () => el().querySelector('.sheet img')?.getAttribute('src') ?? '';
  const box = () => el().querySelector('.page-box input') as HTMLInputElement;

  it('opens at the page in the address, with the printed number and the contents', () => {
    open('40');
    expect(shown()).toMatch(/\/library\/books\/b1\/pages\/40$/);
    expect(box().value).toBe('42');
    const lines = el().querySelectorAll('.toc-line');
    expect(lines.length).toBe(2);
    expect(lines[1].classList.contains('toc-line--on')).toBe(true);
    expect(lines[1].querySelector('.toc-page')?.textContent).toBe('42');
  });

  it('turns pages by the buttons, the arrow keys, the contents and a typed number', () => {
    open(null);
    expect(shown()).toMatch(/pages\/1$/);
    const [prev, next] = [...el().querySelectorAll('.turn button')] as HTMLButtonElement[];
    expect(prev.disabled).toBe(true);

    next.click();
    fixture.detectChanges();
    expect(shown()).toMatch(/pages\/2$/);
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { page: 2 }, replaceUrl: true }),
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(shown()).toMatch(/pages\/1$/);

    (el().querySelectorAll('.toc-line')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(shown()).toMatch(/pages\/5$/);

    // The printed 42 is the PDF's page 40; past the end stops at the last.
    box().value = '42';
    box().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(shown()).toMatch(/pages\/40$/);
    box().value = '999';
    box().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(shown()).toMatch(/pages\/151$/);
  });

  describe('editing', () => {
    const lines = () =>
      [...el().querySelectorAll('.edit-line')].map((li) =>
        [...li.querySelectorAll('input')].map((i) => i.value),
      );
    const set = (input: HTMLInputElement, value: string, event = 'change') => {
      input.value = value;
      input.dispatchEvent(new Event(event));
      fixture.detectChanges();
    };
    const button = (text: string) =>
      [...el().querySelectorAll('.toc button')].find((b) =>
        b.textContent?.includes(text),
      ) as HTMLButtonElement;

    function edit(page: string | null = '5') {
      open(page);
      (el().querySelector('.bar button[title^="A könyv címe"]') as HTMLButtonElement).click();
      fixture.detectChanges();
    }

    it('saves the title, the page shift and the changed lines', () => {
      edit();
      expect(lines()).toEqual([
        ['Mindenki másképp csinálja', '7'],
        ['Darabokra törted a szívem', '42'],
      ]);
      const fields = el().querySelectorAll<HTMLInputElement>('.field:not(.field--row) input');
      set(fields[0], 'Csalamádé', 'input');
      set(fields[1], 'Dalok a tábortűz mellé ', 'input');
      set(fields[2], 'Dobay', 'input');
      // Shown under the title as it is written.
      expect(el().querySelector('.title p')?.textContent).toBe('Dobay · Dalok a tábortűz mellé ');
      // This page (the PDF's 5th) has 9 printed on it: every number moves.
      set(el().querySelector('.field--row input') as HTMLInputElement, '9');
      expect(box().value).toBe('9');
      expect(lines().map((l) => l[1])).toEqual(['9', '44']);
      // A line moved before the other one, by its printed number; one emptied.
      set(el().querySelectorAll('.edit-page')[1] as HTMLInputElement, '6');
      expect(lines().map((l) => l[0])).toEqual([
        'Darabokra törted a szívem',
        'Mindenki másképp csinálja',
      ]);
      set(el().querySelectorAll('.edit-title')[1] as HTMLInputElement, ' ');

      button('Mentés').click();
      respond({
        'PATCH /library/books/b1': (req) => {
          expect(req.request.body).toEqual({
            title: 'Csalamádé',
            subtitle: 'Dalok a tábortűz mellé',
            author: 'Dobay',
            pageOffset: 4,
            toc: [{ title: 'Darabokra törted a szívem', page: 2, level: 0 }],
          });
          return { data: { book: { ...DETAILS, ...req.request.body } } };
        },
        'GET /library': { data: { shelves: SHELVES, scan: IDLE } },
      });
      fixture.detectChanges();
      expect(el().querySelector('.edit-line')).toBeNull();
      expect(el().querySelector('.title h1')?.textContent).toBe('Csalamádé');
      expect(el().querySelector('.title p')?.textContent).toBe('Dobay · Dalok a tábortűz mellé');
      expect(el().querySelectorAll('.toc-line').length).toBe(1);
    });

    it('adds the page shown with its first words, removes a line, and can be left', () => {
      vi.useFakeTimers();
      edit('12');
      button('Ez az oldal').click();
      respond({
        'GET /library/books/b1/pages/12/opening': { data: { opening: 'Nehéz az iskolatáska' } },
      });
      fixture.detectChanges();
      vi.runAllTimers();
      expect(lines()).toEqual([
        ['Mindenki másképp csinálja', '7'],
        ['Nehéz az iskolatáska', '14'],
        ['Darabokra törted a szívem', '42'],
      ]);
      expect(el().querySelector('.edit-line--on input')).toBe(document.activeElement);

      (el().querySelector('.edit-remove') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(lines().length).toBe(2);

      button('Mégse').click();
      fixture.detectChanges();
      expect(el().querySelector('.edit-line')).toBeNull();
      // Nothing was saved: the book's own two lines are back.
      expect(el().querySelectorAll('.toc-line').length).toBe(2);
      expect(waiting()).toEqual([]);
    });

    it('takes a proposal from the book in place of the lines, after asking', async () => {
      edit();
      const confirm = TestBed.inject(ConfirmService);
      button('Javaslat').click();
      await settle();
      expect(confirm.pending()?.confirmText).toBe('Csere');
      confirm.answer(true);
      await settle();
      respond({
        'GET /library/books/b1/toc-proposal': {
          data: { toc: [{ title: 'Chapter 1', page: 3, level: 0 }] },
        },
      });
      fixture.detectChanges();
      expect(lines()).toEqual([['Chapter 1', '5']]);

      // Nothing could be read out: the lines stay, and it says so.
      const errors = vi.spyOn(TestBed.inject(NotificationsService), 'addError');
      button('Javaslat').click();
      await settle();
      confirm.answer(true);
      await settle();
      respond({ 'GET /library/books/b1/toc-proposal': { data: { toc: [] } } });
      fixture.detectChanges();
      expect(errors).toHaveBeenCalled();
      expect(lines()).toEqual([['Chapter 1', '5']]);
    });

    it('keeps the editor open when saving fails', () => {
      edit();
      const errors = vi.spyOn(TestBed.inject(NotificationsService), 'addError');
      set(el().querySelector('.field input') as HTMLInputElement, '  ', 'input');
      button('Mentés').click();
      expect(errors).toHaveBeenCalledWith('A könyvnek kell legyen címe.');
      expect(waiting()).toEqual([]);

      set(el().querySelector('.field input') as HTMLInputElement, 'Cím', 'input');
      button('Mentés').click();
      respond({
        'PATCH /library/books/b1': (req) => {
          // Untouched contents are not sent.
          expect(req.request.body).toEqual({
            title: 'Cím',
            subtitle: '',
            author: '',
            pageOffset: 2,
          });
          return fail(400, 'Nem jó.');
        },
      });
      fixture.detectChanges();
      expect(errors).toHaveBeenLastCalledWith('Nem jó.');
      expect(el().querySelector('.edit-line')).not.toBeNull();
    });
  });

  describe('play-along tracks', () => {
    beforeEach(() => {
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    });

    const chips = () =>
      [...el().querySelectorAll('.page-track')].map((b) =>
        b.textContent?.replace('play_arrow', '').replace('pause', '').trim(),
      );
    const player = () => el().querySelector('app-library-player');

    it('puts a play button on a page with tracks; the player stays while the pages turn', () => {
      open('5');
      expect(chips()).toEqual(['Masképp']);
      expect(player()).toBeNull();
      (el().querySelector('.page-track') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(player()?.querySelector('audio')?.getAttribute('src')).toBe(
        `${API}/library/books/b1/audio/01%20Mask%C3%A9pp.mp3`,
      );

      // Page 7 has none - the button goes, the player stays.
      box().value = '9';
      box().dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(shown()).toMatch(/pages\/7$/);
      expect(chips()).toEqual([]);
      expect(player()).not.toBeNull();

      (player()!.querySelector('button[title="Bezárás"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(player()).toBeNull();
    });

    it("lists the book's tracks with their pages, and plays one from there", () => {
      open(null);
      const lines = [...el().querySelectorAll('.tracks li')];
      expect(lines.map((li) => li.querySelector('.toc-title')?.textContent)).toEqual([
        'Masképp',
        'Darabokra',
      ]);
      // Printed numbers (the shift is 2); a tap goes there.
      const pages = lines[0].querySelectorAll('.track-pages button');
      expect([...pages].map((b) => b.textContent?.trim())).toEqual(['7', '8']);
      (pages[1] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(shown()).toMatch(/pages\/6$/);
      expect(lines[1].querySelector('.track-pages')).toBeNull();

      (lines[1].querySelector('.track-line') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(player()?.querySelector('.name')?.textContent).toBe('Darabokra');
    });

    it('links tracks to the page shown in the editor, and saves the links', () => {
      open('40');
      (el().querySelector('.bar button[title^="A könyv címe"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const boxes = () => [...el().querySelectorAll<HTMLInputElement>('.edit-tracks input')];
      expect(boxes().map((b) => b.checked)).toEqual([false, false]);
      boxes()[1].click();
      fixture.detectChanges();
      expect(boxes().map((b) => b.checked)).toEqual([false, true]);
      // On the page at once.
      expect(chips()).toEqual(['Darabokra']);
      // Off page 6 (printed 8) by its little button.
      const first = el().querySelectorAll('.edit-tracks li')[0];
      (first.querySelectorAll('.track-pages button')[1] as HTMLButtonElement).click();
      fixture.detectChanges();

      (
        [...el().querySelectorAll('.toc button')].find((b) =>
          b.textContent?.includes('Mentés'),
        ) as HTMLButtonElement
      ).click();
      respond({
        'PATCH /library/books/b1': (req) => {
          expect(req.request.body.audioLinks).toEqual([
            { file: '01 Masképp.mp3', page: 5 },
            { file: '02 Darabokra.mp3', page: 40 },
          ]);
          expect(req.request.body.toc).toBeUndefined();
          return { data: { book: { ...DETAILS, audioLinks: req.request.body.audioLinks } } };
        },
        'GET /library': { data: { shelves: SHELVES, scan: IDLE } },
      });
      fixture.detectChanges();
      expect(chips()).toEqual(['Darabokra']);
    });

    it('takes the links guessed from "Track N" in the text', async () => {
      open('5');
      (el().querySelector('.bar button[title^="A könyv címe"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const propose = [...el().querySelectorAll('.toc button')].filter((b) =>
        b.textContent?.includes('Javaslat'),
      )[1] as HTMLButtonElement;
      const confirm = TestBed.inject(ConfirmService);
      propose.click();
      await settle();
      confirm.answer(true);
      await settle();
      respond({
        'GET /library/books/b1/audio-proposal': {
          data: { audioLinks: [{ file: '02 Darabokra.mp3', page: 5 }] },
        },
      });
      fixture.detectChanges();
      expect(chips()).toEqual(['Darabokra']);
    });
  });

  it('says so when there is no such book', () => {
    open(null, fail(404));
    expect(el().querySelector('.note')?.textContent).toContain('Nincs ilyen könyv');
    expect(el().querySelector('.sheet')).toBeNull();
  });
});
