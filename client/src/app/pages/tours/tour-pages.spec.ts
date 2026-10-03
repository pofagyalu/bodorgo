import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { API } from '../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../testing/component';
import { makeTour, tourResponse } from '../../../testing/fixtures';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { AccommodationHouse, Tour, TourService } from '../../services/tour';
import { AccommodationEditor } from '../tour-edit/accommodation-editor/accommodation-editor';
import { TourEdit } from '../tour-edit/tour-edit';
import { TourCard } from './tour-card/tour-card';
import { Tours } from './tours';

let http: HttpTestingController;
let success: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function setUp(providers: unknown[] = []) {
  TestBed.configureTestingModule({ providers: [pageTesting(), ...providers] });
  http = TestBed.inject(HttpTestingController);
  const notifications = TestBed.inject(NotificationsService);
  success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
  error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => vi.restoreAllMocks());

describe('Tours', () => {
  let fixture: ComponentFixture<Tours>;
  let page: Tours;

  const t = (order: number, startDate: string, title = `Tábor ${order}`, summary = '') =>
    makeTour({ _id: `t${order}`, order, startDate, title, summary });
  const T2025 = [t(10, '2025-07-01', 'Mátra'), t(9, '2025-03-01', 'Bükk', 'barlangok')];
  const T2024 = [t(8, '2024-06-01', 'Zemplén')];
  const of = (tours: Tour[]) => ({ status: 'success', results: tours.length, data: { tours } });
  const byYear = (req: { request: { params: { get(k: string): string | null } } }) => {
    const from = req.request.params.get('startDate.gte');
    if (!from) return of([...T2025, ...T2024]);
    return of(from.startsWith('2025') ? T2025 : T2024);
  };

  function open(years: object = { data: { years: [2024, 2025] } }) {
    fixture = TestBed.createComponent(Tours);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /tours/years': years });
    respond({ 'GET /tours': byYear as never });
    fixture.detectChanges();
  }

  beforeEach(() => setUp());

  it('opens on the latest year, newest camp first', () => {
    open();
    expect(page.years()).toEqual([2025, 2024]);
    expect(page.period()).toBe('2025');
    expect(page.loadingAll()).toBe(false);
    expect(page.filteredTours().map((x) => x.title)).toEqual(['Mátra', 'Bükk']);
    expect(fixture.nativeElement.textContent).toContain('Mátra');
  });

  it('loads another year when it is picked, and remembers the choice', () => {
    open();
    page.toggleYears(new Event('click'));
    expect(page.yearsOpen()).toBe(true);
    page.pickPeriod('2024');
    expect(page.yearsOpen()).toBe(false);
    expect(page.filteredTours().map((x) => x.title)).toEqual(['Mátra', 'Bükk']); // until it arrives
    respond({ 'GET /tours': byYear as never });
    fixture.detectChanges(); // the list follows its source through an effect
    expect(page.filteredTours().map((x) => x.title)).toEqual(['Zemplén']);
    expect(TestBed.inject(TourService).toursPeriod).toBe('2024');

    page.pickPeriod('2025'); // already loaded - no new request
    http.expectNone((r) => r.url === `${API}/tours`);
    page.toggleYears(new Event('click'));
    page.closeYears();
    expect(page.yearsOpen()).toBe(false);
  });

  it('comes back to the remembered year, or to all', () => {
    TestBed.inject(TourService).toursPeriod = '2024';
    open();
    expect(page.period()).toBe('2024');

    TestBed.resetTestingModule();
    setUp();
    TestBed.inject(TourService).toursPeriod = 'all';
    open();
    expect(page.period()).toBe('all');
    expect(page.filteredTours()).toHaveLength(3);
  });

  it('shows everything when there are no years at all', () => {
    open({ data: { years: [] } });
    expect(page.period()).toBe('all');
  });

  it('turns the order around', () => {
    open();
    page.toggleOrder();
    expect(page.filteredTours().map((x) => x.title)).toEqual(['Bükk', 'Mátra']);
    expect(TestBed.inject(TourService).toursAscending).toBe(true);
    page.toggleOrder();
  });

  it('searches every year, in titles and summaries, after a short pause', () => {
    vi.useFakeTimers();
    open();
    page.onSearch('zem');
    page.onSearch('ZEMP');
    expect(page.searchInput()).toBe('ZEMP');
    expect(page.searchTerm()).toBe(''); // not yet
    vi.advanceTimersByTime(300);
    respond({ 'GET /tours': byYear as never });
    fixture.detectChanges(); // the list follows its source through an effect
    expect(page.filteredTours().map((x) => x.title)).toEqual(['Zemplén']);

    page.onSearch('barlang');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(page.filteredTours().map((x) => x.title)).toEqual(['Bükk']);

    page.onSearch('');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(page.filteredTours().map((x) => x.title)).toEqual(['Mátra', 'Bükk']); // 2025 again
    vi.useRealTimers();
  });

  it('can retry a year whose request failed', () => {
    fixture = TestBed.createComponent(Tours);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /tours/years': { data: { years: [2025] } } });
    respond({ 'GET /tours': fail() });
    expect(page.loadingAll()).toBe(true);
    page.choosePeriod('2025');
    respond({ 'GET /tours': byYear as never });
    fixture.detectChanges(); // the list follows its source through an effect
    expect(page.loadingAll()).toBe(false);
  });

  it('stays empty when the years cannot be loaded', () => {
    open(fail());
    expect(page.years()).toEqual([]);
    expect(page.filteredTours()).toEqual([]);
  });
});

describe('TourCard', () => {
  it('shows the date and the cover of a tour', () => {
    setUp();
    const fixture = TestBed.createComponent(TourCard);
    fixture.componentRef.setInput(
      'tour',
      makeTour({ startDate: '2026-07-05T08:00:00', coverUpdatedAt: 'v1' }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.formattedStartDate()).toBe('2026. júl. 05.');
    expect(fixture.componentInstance.coverUrl()).toBe(`${API}/tours/t1/cover?v=v1`);
    expect(fixture.nativeElement.textContent).toContain('Mátra');
  });
});

describe('TourEdit', () => {
  let fixture: ComponentFixture<TourEdit>;
  let page: TourEdit;
  let navigate: ReturnType<typeof vi.spyOn>;

  function open(id: string | null, reply?: object) {
    setUp([
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap(id ? { id } : {}) } },
      },
    ]);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    logIn({ role: 'admin' });
    fixture = TestBed.createComponent(TourEdit);
    page = fixture.componentInstance;
    fixture.detectChanges();
    if (reply) {
      respond({
        'GET /tours/t1': reply,
        'GET /tours/t1/rooms': { data: { houses: [], people: [] } },
      });
      fixture.detectChanges();
      respond({ 'GET /tours/t1/rooms': { data: { houses: [], finalized: false, people: [] } } });
    }
  }

  it('starts a new tour with an empty form', () => {
    open(null);
    expect(page.isEditMode).toBe(false);
    expect(page.loading()).toBe(false);
    expect(page.form.title).toBe('');
    expect(page.form.clubSubsidyAmount).toBe(0);
    expect(page.subsidyAllowed).toBe(true);
  });

  it('fills the form from the tour', () => {
    const tour = makeTour({
      startDate: '2026-07-10T08:30:00',
      contact: 'Gazda',
      pricingMode: 'perPerson',
      accommodationPricePerNight: 8000,
      onSitePayment: { cash: true, card: false, szep: true },
      accommodation: { houses: [{ name: 'Faház', description: '', rooms: [] }] },
      coverUpdatedAt: 'v1',
    });
    open('t1', tourResponse(tour));
    expect(page.isEditMode).toBe(true);
    expect(page.loading()).toBe(false);
    expect(page.form).toMatchObject({
      order: 12,
      title: 'Mátra',
      placeName: 'Mátraháza',
      lat: 47.87,
      lng: 19.97,
      startDateLocal: '2026-07-10T08:30',
      pricingMode: 'perPerson',
      accommodationPricePerNight: 8000,
      accommodationCurrency: 'HUF',
      payment: { cash: true, card: false, szep: true },
      existingCoverUrl: `${API}/tours/t1/cover?v=v1`,
    });
    expect(page.accommodationHouses()).toHaveLength(1);
  });

  it('turns away from a closed tour', () => {
    open('t1', tourResponse(makeTour({ closed: true })));
    expect(error).toHaveBeenCalledWith('Ez a tábor le van zárva, már nem módosítható.');
    expect(navigate).toHaveBeenCalledWith(['/taborok', 'matra']);
  });

  it('says so when the tour cannot be loaded', () => {
    open('t1', fail(404));
    expect(page.error()).toBe('A tábor betöltése nem sikerült.');
    expect(page.loading()).toBe(false);
  });

  it('gives no club subsidy to euro tours or to ones before the club existed', () => {
    open(null);
    page.form.startDateLocal = '2018-07-01T10:00';
    expect(page.subsidyAllowed).toBe(false);
    expect(page.subsidyNote).toContain('2019-ben alakult');
    page.form.startDateLocal = '2026-07-01T10:00';
    expect(page.subsidyAllowed).toBe(true);
    page.form.accommodationCurrency = 'EUR';
    expect(page.subsidyAllowed).toBe(false);
    expect(page.subsidyNote).toContain('EUR-ban');
  });

  it('splits pasted "lat, lng" coordinates into the two fields', () => {
    open(null);
    const paste = (text: string) => {
      const event = {
        clipboardData: { getData: () => text },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      page.onCoordinatePaste(event);
      return event.preventDefault;
    };
    expect(paste(' 47.8712, 19.9731 ')).toHaveBeenCalled();
    expect(page.form.lat).toBe(47.8712);
    expect(page.form.lng).toBe(19.9731);
    expect(paste('Mátraháza')).not.toHaveBeenCalled();
    expect(page.form.lat).toBe(47.8712);
  });

  it('creates a tour and goes back to the list', () => {
    open(null);
    Object.assign(page.form, {
      order: 13,
      title: 'Bükk',
      placeName: 'Szilvásvárad',
      lat: 48.1,
      lng: 20.4,
      startDateLocal: '2026-08-01T10:00',
      duration: 4,
      maxCapacity: 30,
      contact: ' Gazda ',
      accommodationCurrency: 'EUR',
      eurHufExchangeRate: 400,
      clubSubsidyAmount: 5000,
      childPricePerNight: 10,
    });
    page.save();
    const req = http.expectOne(`${API}/tours`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      order: 13,
      title: 'Bükk',
      location: { description: 'Szilvásvárad', coordinates: [20.4, 48.1] },
      startDate: new Date('2026-08-01T10:00').toISOString(),
      contact: 'Gazda',
      eurHufExchangeRate: 400,
      clubSubsidyAmount: 0, // no subsidy for a euro tour
    });
    expect(req.request.body.childPricePerNight).toBeUndefined(); // priced per house
    req.flush(tourResponse(makeTour()));
    expect(success).toHaveBeenCalledWith('Tábor létrehozása sikeres');
    expect(navigate).toHaveBeenCalledWith(['/taborok']);
    expect(page.saving()).toBe(false);
  });

  it('saves a tour with its new cover and returns to the tour', () => {
    open('t1', tourResponse(makeTour()));
    page.onCoverFileSelected({
      target: { files: [new File(['x'], 'c.jpg')], value: 'c.jpg' },
    } as unknown as Event);
    expect(page.coverToCrop()?.name).toBe('c.jpg');
    page.onCoverCropped(new Blob(['x']));
    page.onCoverCropped(new Blob(['y'])); // a second pick replaces the preview
    expect(page.coverToCrop()).toBeNull();
    expect(page.coverPreviewUrl()).toBeTruthy();

    page.form.pricingMode = 'perPerson';
    page.form.childPricePerNight = 3000;
    page.form.childAgeLimitYears = 12;
    page.save();
    const req = http.expectOne((r) => r.method === 'PATCH');
    expect(req.request.body).toMatchObject({ childPricePerNight: 3000, childAgeLimitYears: 12 });
    expect(req.request.body.eurHufExchangeRate).toBeUndefined();
    req.flush(tourResponse(makeTour()));
    expect(success).toHaveBeenCalledWith('Tábor mentése sikeres');
    expect(navigate).not.toHaveBeenCalledWith(['/taborok', 'matra']); // the cover goes up first
    respond({ 'POST /tours/t1/cover': {} });
    expect(navigate).toHaveBeenCalledWith(['/taborok', 'matra']);
    fixture.destroy();
  });

  it('still leaves when only the cover upload failed', () => {
    open('t1', tourResponse(makeTour()));
    page.onCoverCropped(new Blob(['x']));
    page.save();
    respond({ 'PATCH /tours/t1': tourResponse(makeTour()) });
    respond({ 'POST /tours/t1/cover': fail() });
    expect(error).toHaveBeenCalledWith('A tábor elmentve, de a borítókép feltöltése nem sikerült.');
    expect(navigate).toHaveBeenCalledWith(['/taborok', 'matra']);
  });

  it('stays on the form when the save fails', () => {
    open('t1', tourResponse(makeTour()));
    page.save();
    respond({ 'PATCH /tours/t1': fail(400, 'A sorszám már foglalt.') });
    expect(error).toHaveBeenCalledWith('A sorszám már foglalt.');
    expect(page.saving()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a cover that cannot be opened', () => {
    open(null);
    page.coverToCrop.set(new File(['x'], 'c.heic'));
    page.onCoverCropFailed();
    expect(page.coverToCrop()).toBeNull();
    expect(error.mock.calls[0][0]).toContain('nem sikerült megnyitni');
    page.onCoverFileSelected({ target: { files: [], value: '' } } as unknown as Event);
    expect(page.coverToCrop()).toBeNull();
  });
});

describe('AccommodationEditor', () => {
  let fixture: ComponentFixture<AccommodationEditor>;
  let editor: AccommodationEditor;
  let confirm: ConfirmService;

  const HOUSES: AccommodationHouse[] = [
    {
      _id: 'h1',
      name: 'Faház',
      description: '',
      rooms: [
        { _id: 'r1', name: 'Emelet', description: '', beds: 4 },
        { _id: 'r2', name: 'Földszint', description: '', beds: 2 },
      ],
    },
  ];

  beforeEach(() => {
    setUp();
    confirm = TestBed.inject(ConfirmService);
    fixture = TestBed.createComponent(AccommodationEditor);
    editor = fixture.componentInstance;
    fixture.componentRef.setInput('tourId', 't1');
    fixture.componentRef.setInput('initialHouses', HOUSES);
    fixture.componentRef.setInput('maxCapacity', 10);
    fixture.detectChanges();
    respond({
      'GET /tours/t1/rooms': {
        data: {
          houses: [],
          finalized: false,
          people: [{ roomId: 'r1' }, { roomId: 'r1' }, { roomId: null }],
        },
      },
    });
    fixture.detectChanges();
  });

  it('counts houses, rooms and beds, and warns when the beds are too few', () => {
    expect(editor.totals()).toEqual({ houses: 1, rooms: 2, beds: 6 });
    expect(editor.tooFewBeds()).toBe(true);
    editor.setBeds(0, 0, '8');
    expect(editor.totals().beds).toBe(10);
    expect(editor.tooFewBeds()).toBe(false);
    expect(editor.dirty()).toBe(true);
  });

  it('edits a copy: the tour keeps its houses until the save', () => {
    editor.setHouse(0, 'name', 'Kőház');
    editor.setRoom(0, 1, 'description', 'kandallós');
    expect(HOUSES[0].name).toBe('Faház');
    expect(editor.houses()[0].name).toBe('Kőház');
    editor.reset();
    expect(editor.houses()[0].name).toBe('Faház');
    expect(editor.dirty()).toBe(false);
  });

  it('adds houses and rooms', () => {
    editor.addHouse();
    editor.addRoom(1);
    fixture.detectChanges();
    expect(editor.houses()[1].rooms).toEqual([{ name: '', description: '', beds: 2 }]);
  });

  it('asks before removing a room people are assigned to', async () => {
    void editor.removeRoom(0, 0);
    expect(confirm.pending()?.message).toContain('2 ember van beosztva');
    confirm.answer(false);
    await settle();
    expect(editor.houses()[0].rooms).toHaveLength(2);

    await editor.removeRoom(0, 1); // empty room: no question
    expect(editor.houses()[0].rooms.map((r) => r.name)).toEqual(['Emelet']);

    void editor.removeRoom(0, 0);
    confirm.answer(true);
    await settle();
    expect(editor.houses()[0].rooms).toEqual([]);
  });

  it('asks before removing a house that has rooms', async () => {
    void editor.removeHouse(0);
    expect(confirm.pending()?.message).toContain('"Faház"');
    expect(confirm.pending()?.message).toContain('2 ember van beosztva');
    confirm.answer(false);
    await settle();
    expect(editor.houses()).toHaveLength(1);

    editor.addHouse();
    await editor.removeHouse(1); // no rooms: no question
    expect(editor.houses()).toHaveLength(1);

    void editor.removeHouse(0);
    confirm.answer(true);
    await settle();
    expect(editor.houses()).toEqual([]);
  });

  it('refuses to save unnamed houses or rooms and impossible bed counts', () => {
    editor.addHouse();
    editor.save();
    expect(editor.showErrors()).toBe(true);
    expect(error).toHaveBeenCalledWith('Minden háznak és szobának adj nevet, és 1-20 férőhelyet.');

    editor.reset();
    editor.setBeds(0, 0, '25');
    editor.save();
    expect(error).toHaveBeenCalledTimes(2);
    http.expectNone((r) => r.method === 'PUT');
  });

  it('saves the houses', () => {
    const saved: AccommodationHouse[][] = [];
    editor.saved.subscribe((h) => saved.push(h));
    editor.setHouse(0, 'name', 'Kőház');
    editor.save();
    const req = http.expectOne(`${API}/tours/t1/accommodation`);
    expect(req.request.body.houses[0].name).toBe('Kőház');
    req.flush({ data: { accommodation: { houses: req.request.body.houses } } });
    expect(saved[0][0].name).toBe('Kőház');
    expect(success).toHaveBeenCalledWith('Szállás mentve');
    expect(editor.showErrors()).toBe(false);

    editor.save();
    respond({ 'PUT /tours/t1/accommodation': fail() });
    expect(error).toHaveBeenCalledWith('Nem sikerült menteni a szállást.');
    expect(editor.saving()).toBe(false);
  });
});
