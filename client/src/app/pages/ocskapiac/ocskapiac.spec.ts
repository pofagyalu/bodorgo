import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, formEntries, httpTesting, itSendsRequests } from '../../../testing/http';
import { logIn, pageTesting, respond, settle } from '../../../testing/component';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { MarketItem, MarketService, priceLabel } from '../../services/market';
import { MarketCard, daysLeft } from './market-card/market-card';
import { MarketItemDialog } from './market-item/market-item';
import { MarketForm } from './market-form/market-form';
import { Ocskapiac } from './ocskapiac';

const MARKET = `${API}/ocskapiac`;

const person = (name: string, _id = name) => ({ _id, name, username: '' });

const item = (over: Partial<MarketItem> = {}): MarketItem => ({
  _id: 'i1',
  title: 'Fél doboz csavar',
  description: '4×40-es',
  category: 'barkacs',
  price: { kind: 'sor', amount: 2 },
  owner: person('Anna', 'anna'),
  photos: [{ _id: 'ph1', width: 1600, height: 1200 }],
  status: 'available',
  reservedBy: null,
  reservedUntil: null,
  wanted: [],
  notes: [],
  mine: false,
  iWant: false,
  iReserved: false,
  createdAt: '2026-10-16T10:00:00Z',
  goneAt: null,
  ...over,
});

let http: HttpTestingController;
let success: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function setUp() {
  TestBed.configureTestingModule({ providers: [pageTesting()] });
  http = TestBed.inject(HttpTestingController);
  const notifications = TestBed.inject(NotificationsService);
  success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
  error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
}

afterEach(() => vi.restoreAllMocks());

describe('MarketService', () => {
  const service = () => TestBed.inject(MarketService);
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  itSendsRequests([
    ['getItems', () => service().getItems(), 'GET', MARKET],
    ['getItem', () => service().getItem('i1'), 'GET', `${MARKET}/i1`],
    ['delete', () => service().delete('i1'), 'DELETE', `${MARKET}/i1`],
    ['markGone', () => service().markGone('i1'), 'POST', `${MARKET}/i1/gone`],
    ['want', () => service().want('i1'), 'POST', `${MARKET}/i1/want`],
    ['unwant', () => service().unwant('i1'), 'DELETE', `${MARKET}/i1/want`],
    ['dibs', () => service().dibs('i1'), 'POST', `${MARKET}/i1/dibs`],
    ['undibs', () => service().undibs('i1'), 'DELETE', `${MARKET}/i1/dibs`],
    [
      'addNote',
      () => service().addNote('i1', 'Hívlak!'),
      'POST',
      `${MARKET}/i1/notes`,
      { text: 'Hívlak!' },
    ],
    ['deleteNote', () => service().deleteNote('i1', 'n1'), 'DELETE', `${MARKET}/i1/notes/n1`],
  ]);

  it('sends a new item as multipart, the photos as foto-N.jpg', () => {
    service()
      .create({
        title: 'Lekvár',
        description: '',
        category: 'kezmuves',
        price: { kind: 'forint', amount: 800 },
        newPhotos: [new Blob(['a']), new Blob(['b'])],
        removePhotos: [],
      })
      .subscribe();
    const req = http.expectOne(MARKET);
    expect(req.request.method).toBe('POST');
    expect(formEntries(req.request.body)).toMatchObject({
      title: 'Lekvár',
      category: 'kezmuves',
      priceKind: 'forint',
      priceAmount: '800',
    });
    expect((req.request.body as FormData).getAll('photos')).toHaveLength(2);
    req.flush({ data: { item: item() } });
  });

  it('keeps the menu badge: refreshed from the server, gone once the list is opened', () => {
    service().refreshNew();
    http.expectOne(`${MARKET}/new-count`).flush({ data: { count: 3 } });
    expect(service().newCount()).toBe(3);
    service().getItems().subscribe();
    http.expectOne(MARKET).flush({ data: { items: [] } });
    expect(service().newCount()).toBe(0);
    // A failed refresh leaves it as it was.
    service().refreshNew();
    http.expectOne(`${MARKET}/new-count`).flush(null, { status: 500, statusText: 'Error' });
    expect(service().newCount()).toBe(0);
  });

  it('builds the photo URLs', () => {
    expect(service().photoUrl('i1', 'p1')).toBe(`${MARKET}/i1/photos/p1`);
    expect(service().thumbUrl('i1', 'p1')).toBe(`${MARKET}/i1/photos/p1/thumb`);
  });
});

describe('Ócskapiac helpers', () => {
  it('says the price the fun way', () => {
    expect(priceLabel({ kind: 'sor', amount: 2 })).toBe('🍺 2 sör');
    expect(priceLabel({ kind: 'ingyen', amount: null })).toBe('🎁 Ingyen elvihető');
    expect(priceLabel({ kind: 'lekvar', amount: 1 })).toBe('🫙 1 üveg lekvár');
    expect(priceLabel({ kind: 'forint', amount: 15000 })).toMatch(/^💰 15\s000 Ft$/);
  });

  it('counts the days a stipistopi still holds - at least 1', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(daysLeft('2026-10-23T12:00:00Z', now)).toBe(7);
    expect(daysLeft('2026-10-16T13:00:00Z', now)).toBe(1);
    expect(daysLeft(null, now)).toBe(0);
  });
});

describe('MarketCard', () => {
  it('shows the stamp and who holds it', () => {
    setUp();
    const fixture = TestBed.createComponent(MarketCard);
    fixture.componentRef.setInput(
      'item',
      item({
        status: 'reserved',
        reservedBy: person('Béla'),
        reservedUntil: new Date(Date.now() + 3 * 86_400_000 - 1000).toISOString(),
      }),
    );
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Stipistopi!');
    expect(text).toContain('Béla – még 3 napig');
    expect(text).toContain('🍺 2 sör');
  });
});

describe('Ocskapiac page', () => {
  function open() {
    setUp();
    logIn({ role: 'guest' });
    const fixture = TestBed.createComponent(Ocskapiac);
    fixture.detectChanges();
    return fixture;
  }

  it('lists the items, filters by tab and search', () => {
    const fixture = open();
    const page = fixture.componentInstance;
    respond({
      'GET /ocskapiac': {
        data: {
          items: [
            item(),
            item({ _id: 'i2', title: 'Gyerekcipő', price: { kind: 'ingyen', amount: null } }),
            item({ _id: 'i3', title: 'Lámpa', mine: true }),
            item({ _id: 'i4', title: 'Régi bicikli', status: 'gone', photos: [] }),
          ],
        },
      },
    });
    fixture.detectChanges();
    expect(page.shown().map((i) => i._id)).toEqual(['i1', 'i2', 'i3']);
    page.setFilter('free');
    expect(page.shown().map((i) => i._id)).toEqual(['i2']);
    page.setFilter('mine');
    expect(page.shown().map((i) => i._id)).toEqual(['i3']);
    page.setFilter('gone');
    expect(page.shown().map((i) => i._id)).toEqual(['i4']);
    page.setFilter('all');
    page.search.set('cipo');
    expect(page.shown().map((i) => i._id)).toEqual(['i2']);
    expect(page.tabOptions().find((t) => t.value === 'all')?.count).toBe(1);
    page.search.set('');
    page.setCategory('gyerek');
    expect(page.shown()).toEqual([]);
    page.setCategory('barkacs');
    expect(page.shown().map((i) => i._id)).toEqual(['i1', 'i2', 'i3']);
    page.clearFilters();
    expect(page.category()).toBe('all');
  });

  it('a saved new item goes to the top and opens', () => {
    const fixture = open();
    const page = fixture.componentInstance;
    respond({ 'GET /ocskapiac': { data: { items: [item()] } } });
    page.form.set('new');
    page.saved(item({ _id: 'new', mine: true }));
    expect(page.items()[0]._id).toBe('new');
    expect(page.form()).toBeNull();
  });

  it('says so when the market is empty', () => {
    const fixture = open();
    respond({ 'GET /ocskapiac': { data: { items: [] } } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Légy te az első');
  });
});

describe('MarketItemDialog', () => {
  function open(it: MarketItem) {
    setUp();
    logIn({ role: 'member' });
    const fixture = TestBed.createComponent(MarketItemDialog);
    fixture.componentRef.setInput('item', it);
    const changes: MarketItem[] = [];
    fixture.componentInstance.changed.subscribe((i) => changes.push(i));
    fixture.detectChanges();
    return { dialog: fixture.componentInstance, fixture, changes };
  }

  it('Kérem! and Stipistopi! for someone else’s item', () => {
    const { dialog, changes } = open(item());
    dialog.toggleWant();
    respond({ 'POST /ocskapiac/i1/want': { data: { item: item({ iWant: true }) } } });
    expect(changes[0].iWant).toBe(true);
    dialog.dibs();
    respond({
      'POST /ocskapiac/i1/dibs': { data: { item: item({ status: 'reserved', iReserved: true }) } },
    });
    expect(changes[1].iReserved).toBe(true);
    expect(success).toHaveBeenCalledTimes(2);
  });

  it('a note is cleared only once it was sent', () => {
    const { dialog } = open(item());
    dialog.note.set('Hívlak este!');
    dialog.sendNote(new Event('submit'));
    const req = http.expectOne(`${MARKET}/i1/notes`);
    expect(req.request.body).toEqual({ text: 'Hívlak este!' });
    req.flush({ message: 'hiba' }, { status: 400, statusText: 'Bad' });
    expect(dialog.note()).toBe('Hívlak este!');
    expect(error).toHaveBeenCalledWith('hiba');
  });

  it('the owner marks it Odaadtam after saying yes', async () => {
    const { dialog, fixture, changes } = open(item({ mine: true }));
    expect(fixture.nativeElement.textContent).toContain('Odaadtam');
    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    await dialog.markGone();
    await settle();
    respond({
      'POST /ocskapiac/i1/gone': { data: { item: item({ status: 'gone', photos: [] }) } },
    });
    expect(changes[0].status).toBe('gone');
  });
});

describe('MarketForm', () => {
  it('needs a title and a photo; sends the price with its amount', () => {
    setUp();
    const fixture = TestBed.createComponent(MarketForm);
    const form = fixture.componentInstance;
    fixture.detectChanges();
    form.title.set('Lekvár');
    expect(form.canSave()).toBe(false);
    form.photos.set([{ kind: 'new', blob: new Blob(['x']), url: 'blob:x' }]);
    form.setPriceKind('lekvar');
    expect(form.amount()).toBe(1);
    form.setAmount('3');
    expect(form.canSave()).toBe(true);
    const saved: MarketItem[] = [];
    form.saved.subscribe((i) => saved.push(i));
    form.submit(new Event('submit'));
    const req = http.expectOne(MARKET);
    expect(formEntries(req.request.body)).toMatchObject({ priceKind: 'lekvar', priceAmount: '3' });
    req.flush({ data: { item: item() } });
    expect(saved).toHaveLength(1);
  });

  it('editing: a photo taken off is sent as removePhotos', () => {
    setUp();
    const fixture = TestBed.createComponent(MarketForm);
    fixture.componentRef.setInput(
      'item',
      item({
        mine: true,
        photos: [
          { _id: 'ph1', width: 1, height: 1 },
          { _id: 'ph2', width: 1, height: 1 },
        ],
      }),
    );
    fixture.detectChanges();
    const form = fixture.componentInstance;
    form.removePhoto(form.photos()[0]);
    form.submit(new Event('submit'));
    const req = http.expectOne(`${MARKET}/i1`);
    expect(req.request.method).toBe('PATCH');
    expect((req.request.body as FormData).getAll('removePhotos')).toEqual(['ph1']);
    req.flush({ data: { item: item() } });
  });
});
