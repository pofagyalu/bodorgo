import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, formEntries } from '../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../testing/component';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { ClubDocument } from '../../services/club-document';
import { Transaction } from '../../services/finance';
import { Documents } from './documents/documents';
import { Finance } from './finance/finance';
import { Klub } from './klub';
import { Overview } from './overview/overview';

const Y = new Date().getFullYear();

const tx = (over: Partial<Transaction>): Transaction => ({
  _id: Math.random().toString(36),
  date: `${Y}-03-01`,
  name: 'Tétel',
  type: 'income',
  category: 'Tagdíj',
  amount: 1000,
  currency: 'HUF',
  createdBy: 'me',
  createdAt: `${Y}-03-01`,
  ...over,
});

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [pageTesting()] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('Klub', () => {
  it('shows the menu by role', () => {
    const fixture = TestBed.createComponent(Klub);
    const page = fixture.componentInstance;
    fixture.detectChanges();
    expect(page.isMember()).toBe(false);
    expect(page.isAdmin()).toBe(false);

    logIn({ role: 'member' });
    fixture.detectChanges();
    expect(page.isMember()).toBe(true);
    expect(page.songbook()).toBe('/media/zene/daloskonyv');

    logIn({ role: 'admin' });
    expect(page.isAdmin()).toBe(true);
  });
});

describe('Finance', () => {
  let fixture: ComponentFixture<Finance>;
  let page: Finance;
  let http: HttpTestingController;

  const TRANSACTIONS = [
    tx({ date: `${Y - 1}-05-01`, amount: 9000 }),
    tx({ date: `${Y - 1}-06-01`, type: 'expense', category: 'Egyéb', amount: 4000 }),
    tx({ date: `${Y}-02-01`, amount: 6000 }),
    tx({ date: `${Y}-04-01`, type: 'expense', category: 'Szállásköltség', amount: 3000 }),
    tx({ date: `${Y}-03-01`, type: 'expense', category: 'Ajándék', amount: 1000 }),
  ];

  function open(reply: object = { data: { transactions: TRANSACTIONS } }) {
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Finance);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /finance/transactions': reply });
    fixture.detectChanges();
  }

  it("shows this year's items, newest first, with the totals", () => {
    open();
    expect(page.loading()).toBe(false);
    expect(page.filteredTransactions().map((t) => t.date.slice(5))).toEqual([
      '04-01',
      '03-01',
      '02-01',
    ]);
    expect(page.incomeTotal()).toBe(6000);
    expect(page.expenseTotal()).toBe(4000);
    expect(page.balance()).toBe(2000);
    expect(page.periodOptions().map((p) => p.value)).toEqual(['all', String(Y), String(Y - 1)]);
  });

  it('shows every year under "Összes"', () => {
    open();
    page.period.set('all');
    expect(page.filteredTransactions()).toHaveLength(5);
    expect(page.balance()).toBe(7000);
    expect(page.waterfall()[0]).toMatchObject({ label: 'Nyitó', to: 0 });
  });

  it('builds the waterfall: opening balance, incomes, expenses, closing balance', () => {
    open();
    expect(page.waterfall()).toEqual([
      { label: 'Nyitó', from: 0, to: 5000, kind: 'total' },
      { label: 'Tagdíj', from: 5000, to: 11000, kind: 'in' },
      { label: 'Szállásköltség', from: 11000, to: 8000, kind: 'out' },
      { label: 'Ajándék', from: 8000, to: 7000, kind: 'out' },
      { label: 'Záró', from: 0, to: 7000, kind: 'total' },
    ]);
  });

  it('breaks the expenses down by category, largest first', () => {
    open();
    expect(page.categoryBreakdown()).toEqual([
      { category: 'Szállásköltség', amount: 3000, pct: 75 },
      { category: 'Ajándék', amount: 1000, pct: 25 },
    ]);
  });

  it('only lets an admin add items', () => {
    open();
    expect(page.isAdmin()).toBe(false);
    logIn({ role: 'admin' });
    expect(page.isAdmin()).toBe(true);
  });

  it('opens when the list cannot be loaded', () => {
    open(fail());
    expect(page.loading()).toBe(false);
    expect(page.filteredTransactions()).toEqual([]);
    expect(page.categoryBreakdown()).toEqual([]);
  });

  it('offers the categories of the chosen kind', () => {
    open();
    page.openModal();
    expect(page.formCategoryOptions()).toBe(page.incomeCategories);
    page.onTypeChange('expense');
    expect(page.formCategoryOptions()).toBe(page.expenseCategories);
    expect(page.formCategory()).toBe('Szállásköltség');
    page.onTypeChange('income');
    expect(page.formCategory()).toBe('Tagdíj');
  });

  it('refuses a half-filled form', () => {
    open();
    page.openModal();
    page.onSubmit(new Event('submit'));
    expect(page.formError()).toBe('Kérlek tölts ki minden mezőt.');
    page.formName.set('Terembérlet');
    page.formAmount.set(-5);
    page.submit();
    expect(page.formError()).toBe('Kérlek tölts ki minden mezőt.');
    http.expectNone(`${API}/finance/transactions`);
  });

  it('saves a new item and jumps to its year', () => {
    open();
    page.openModal();
    fixture.detectChanges();
    page.onTypeChange('expense');
    page.formName.set(' Terembérlet ');
    page.formAmount.set(2500);
    page.formDate.set(`${Y - 1}-11-20`);
    page.submit();
    page.closeModal(); // not while saving
    expect(page.showModal()).toBe(true);

    const req = http.expectOne(`${API}/finance/transactions`);
    expect(req.request.body).toEqual({
      date: `${Y - 1}-11-20`,
      name: 'Terembérlet',
      type: 'expense',
      category: 'Szállásköltség',
      amount: 2500,
      currency: 'HUF',
    });
    req.flush({ data: { transaction: tx({ ...req.request.body }) } });
    expect(page.showModal()).toBe(false);
    expect(page.period()).toBe(String(Y - 1));
    expect(page.transactions()).toHaveLength(6);
  });

  it('keeps the form open when the save fails, and closes on request', () => {
    open();
    page.openModal();
    page.formName.set('Tagdíj');
    page.formAmount.set(1000);
    page.submit();
    respond({ 'POST /finance/transactions': fail() });
    expect(page.formError()).toBe('Nem sikerült menteni a tételt.');
    expect(page.showModal()).toBe(true);
    page.closeModal();
    expect(page.showModal()).toBe(false);
  });

  it('formats forints and euros', () => {
    open();
    expect(page.money(1500)).toBe('1500 Ft');
    expect(page.money(20, 'EUR')).toBe('20 €');
  });
});

describe('Overview', () => {
  let fixture: ComponentFixture<Overview>;
  let page: Overview;

  const member = (id: string, over = {}) => ({
    _id: id,
    name: id,
    role: 'member',
    createdAt: '',
    toursAttended: 0,
    ...over,
  });

  function open(routes: Record<string, object>) {
    fixture = TestBed.createComponent(Overview);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond(routes);
    fixture.detectChanges();
  }

  it('counts who has paid this year among those who owe a fee', () => {
    open({
      'GET /membership/users': {
        data: {
          users: [
            member('a'),
            member('b', { role: 'admin' }),
            member('late', { memberSince: Y + 1 }),
            member('g', { role: 'guest' }),
          ],
        },
      },
      'GET /finance/transactions': {
        data: {
          transactions: [
            tx({ user: 'a', membershipYear: Y, amount: 5000 }),
            tx({ user: 'b', membershipYear: Y - 1, date: `${Y - 1}-01-01` }),
            tx({ type: 'expense', category: 'Egyéb', amount: 2000, date: `${Y}-05-01` }),
            tx({ date: `${Y}-06-01` }),
            tx({ date: `${Y}-07-01` }),
          ],
        },
      },
      'GET /settings/membership-fees': {
        data: { fees: [], foundingYear: 2019, paymentDeadline: { month: 3, day: 31 } },
      },
    });

    expect(page.clubMembers().map((m) => m._id)).toEqual(['a', 'b', 'late']);
    expect(page.eligibleThisYear().map((m) => m._id)).toEqual(['a', 'b']);
    expect(page.paidThisYear().map((m) => m._id)).toEqual(['a']);
    expect(page.totalBalance()).toBe(5000 + 1000 - 2000 + 1000 + 1000);
    expect(page.recentActivity()).toHaveLength(4);
    expect(page.recentActivity()[0].date).toBe(`${Y}-07-01`);
    expect(page.paymentDeadline()).toBe('március 31.');
    expect(page.money(5, 'EUR')).toBe('5 €');
    expect(page.money(5)).toBe('5 Ft');
  });

  it('opens empty when nothing could be loaded', () => {
    open({
      'GET /membership/users': fail(),
      'GET /finance/transactions': fail(),
      'GET /settings/membership-fees': fail(),
    });
    expect(page.clubMembers()).toEqual([]);
    expect(page.totalBalance()).toBe(0);
    expect(page.paymentDeadline()).toBeNull();
  });

  it('has no deadline to show when none is set', () => {
    open({ 'GET /settings/membership-fees': { data: { fees: [], foundingYear: 2019 } } });
    expect(page.paymentDeadline()).toBeNull();
  });
});

describe('Documents', () => {
  let fixture: ComponentFixture<Documents>;
  let page: Documents;
  let http: HttpTestingController;

  const doc = (over: Partial<ClubDocument> & { _id: string }): ClubDocument => ({
    name: over._id,
    filename: `${over._id}.pdf`,
    category: 'Számlák',
    uploadedBy: 'me',
    createdAt: '',
    ...over,
  });
  const DOCS = [doc({ _id: 'd1' }), doc({ _id: 'd2', category: 'Egyéb', filename: 'kep.JPG' })];

  function open(reply: object = { data: { documents: DOCS } }) {
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Documents);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({
      'GET /documents': reply,
      'GET /songs': { data: { songs: [], canEdit: false, lastChanged: '2025-05-01T10:00:00Z' } },
    });
    fixture.detectChanges();
  }

  it('groups the documents by category, with the songbook under the first one', () => {
    open();
    expect(page.loading()).toBe(false);
    expect(
      page.groupedDocuments().map((g) => [g.category, g.documents.length, g.songbook]),
    ).toEqual([
      ['Alapdokumentumok', 0, true],
      ['Számlák', 1, false],
      ['Egyéb', 1, false],
    ]);
    expect(page.icon(DOCS[0])).toBe('picture_as_pdf');
    expect(page.icon(DOCS[1])).toBe('image');
    expect(page.fileUrl(DOCS[0])).toBe(`${API}/documents/d1/file`);
    expect(page.fileUrl(DOCS[0], true)).toBe(`${API}/documents/d1/file?download=1`);
    expect(page.previewUrl(DOCS[0])).toBe(`${API}/documents/d1/preview`);
  });

  it('offers the songbook with the chosen chord diagrams', () => {
    open();
    expect(page.bookYear()).toBe(2025);
    expect(page.bookUrl()).toBe(`${API}/songs/book.pdf?diagrams=guitar`);
    expect(page.bookPreviewUrl()).toContain('book.webp?diagrams=guitar&v=');
    page.chooseBookDiagrams('ukulele');
    expect(page.bookDownloadUrl()).toBe(`${API}/songs/book.pdf?diagrams=ukulele&download=1`);
    page.chooseBookDiagrams('whatever');
    expect(page.bookUrl()).toBe(`${API}/songs/book.pdf`);
  });

  it('opens when the list cannot be loaded', () => {
    open(fail());
    expect(page.loading()).toBe(false);
    expect(page.documents()).toEqual([]);
  });

  it('needs a name and a file to upload', () => {
    open();
    page.openUpload();
    fixture.detectChanges();
    page.onSubmit(new Event('submit'));
    expect(page.uploadError()).toContain('Adj meg egy nevet');
    http.expectNone((r) => r.method === 'POST');
  });

  it('uploads a document and adds it to the list', () => {
    logIn({ role: 'admin' });
    open();
    expect(page.isAdmin()).toBe(true);
    page.openUpload();
    page.formName.set(' Beszámoló ');
    page.formYear.set('2025');
    page.formCategory.set('Számlák');
    const file = new File(['x'], 'b.pdf');
    page.onFileSelected({ target: { files: [file] } } as unknown as Event);
    page.onSubmit(new Event('submit'));
    page.closeUpload(); // not while uploading
    expect(page.showUpload()).toBe(true);

    const req = http.expectOne((r) => r.method === 'POST');
    expect(formEntries(req.request.body)).toEqual({
      name: 'Beszámoló',
      category: 'Számlák',
      year: '2025',
      file: 'b.pdf',
    });
    req.flush({ data: { document: doc({ _id: 'd3' }) } });
    expect(page.documents()).toHaveLength(3);
    expect(page.showUpload()).toBe(false);
  });

  it('shows why an upload failed, and can be closed', () => {
    open();
    page.openUpload();
    page.formName.set('Kép');
    page.onFileSelected({ target: { files: [new File(['x'], 'a.gif')] } } as unknown as Event);
    page.onSubmit(new Event('submit'));
    respond({ 'POST /documents': fail(400, 'Csak PDF, JPG vagy PNG.') });
    expect(page.uploadError()).toBe('Csak PDF, JPG vagy PNG.');
    page.closeUpload();
    expect(page.showUpload()).toBe(false);

    page.onFileSelected({ target: { files: null } } as unknown as Event);
    expect(page.formFile()).toBeNull();
  });

  it('deletes a document only after a yes', async () => {
    open();
    const confirm = TestBed.inject(ConfirmService);
    void page.remove(DOCS[0]);
    confirm.answer(false);
    await settle();
    http.expectNone(`${API}/documents/d1`);

    void page.remove(DOCS[0]);
    confirm.answer(true);
    await settle();
    expect(page.deletingId()).toBe('d1');
    void page.remove(DOCS[1]); // one at a time
    respond({ 'DELETE /documents/d1': {} });
    expect(page.documents().map((d) => d._id)).toEqual(['d2']);
  });

  it('reports a failed delete', async () => {
    open();
    const error = vi
      .spyOn(TestBed.inject(NotificationsService), 'addError')
      .mockImplementation(() => {});
    void page.remove(DOCS[0]);
    TestBed.inject(ConfirmService).answer(true);
    await settle();
    respond({ 'DELETE /documents/d1': fail() });
    expect(error).toHaveBeenCalledWith('Nem sikerült törölni a dokumentumot.');
    expect(page.deletingId()).toBeNull();
    expect(page.documents()).toHaveLength(2);
  });
});
