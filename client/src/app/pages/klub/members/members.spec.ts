import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { API } from '../../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../../testing/component';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { MemberUser } from '../../../services/membership';
import { InvitationPerson, InvitationsPanel } from './invitations-panel/invitations-panel';
import { Members, TAB_KEYS } from './members';
import { PeopleTable, sortUsers, userStatus } from './people-table/people-table';

const Y = new Date().getFullYear();

const user = (over: Partial<MemberUser> & { _id: string; name: string }): MemberUser => ({
  role: 'member',
  createdAt: '2020-01-01',
  toursAttended: 0,
  ...over,
});

const USERS: MemberUser[] = [
  user({ _id: 'me', name: 'Teszt Elek', familyId: 'f1', memberSince: Y - 1, email: 'elek@x.hu' }),
  user({ _id: 'kid', name: 'Teszt Kata', familyId: 'f1', memberSince: Y }),
  user({ _id: 'boss', name: 'Admin Anna', role: 'admin', lastLoginAt: '2026-01-01' }),
  user({ _id: 'guest', name: 'Vendég Vera', role: 'guest', email: 'vera@x.hu' }),
];

const dues = (userId: string, year: number, over = {}) => ({
  _id: `${userId}-${year}`,
  date: `${year}-02-01`,
  name: 'Tagdíj',
  type: 'income',
  category: 'Tagdíj',
  amount: 5000,
  currency: 'HUF',
  user: userId,
  membershipYear: year,
  ...over,
});

const loaded = (): Record<string, object> => ({
  'GET /settings/membership-fees': {
    data: { fees: [{ fromYear: 2019, amount: 5000 }], foundingYear: 2019 },
  },
  'GET /membership/users': { data: { users: USERS } },
  'GET /finance/transactions': {
    data: {
      transactions: [
        dues('me', Y, { payment: 'pay1', paymentMethod: 'cash' }),
        { ...dues('me', Y - 1), type: 'expense' }, // not a paid fee
      ],
    },
  },
  'GET /settings/payment-methods': {
    data: {
      stripe: { enabled: true, feePercent: 0, feeFixed: 0, feeMin: 0 },
      barion: { enabled: true, feePercent: 0, feeFixed: 0, feeMin: 0 },
    },
  },
});

describe('Members', () => {
  let fixture: ComponentFixture<Members>;
  let page: Members;
  let http: HttpTestingController;
  let success: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let navigate: ReturnType<typeof vi.spyOn>;

  function open(
    query: Record<string, string> = {},
    role = 'member',
    routes: Record<string, object> = loaded(),
  ) {
    TestBed.configureTestingModule({
      imports: [Members],
      providers: [
        pageTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const notifications = TestBed.inject(NotificationsService);
    success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
    error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logIn({ id: 'me', role, familyId: 'f1' });

    fixture = TestBed.createComponent(Members);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond(routes);
    fixture.detectChanges();
  }

  afterEach(() => vi.restoreAllMocks());

  it('splits the people into club members and the others', () => {
    open();
    expect(page.loading()).toBe(false);
    expect(page.clubMembers().map((u) => u._id)).toEqual(['me', 'kid', 'boss']);
    expect(page.casualUsers().map((u) => u._id)).toEqual(['guest']);
    expect(page.tabOptions().map((t) => [t.value, t.count])).toEqual([
      ['club', 3],
      ['casual', 1],
      ['everyone', 4],
    ]);
    expect(fixture.nativeElement.textContent).toContain('Teszt Kata');
  });

  it('gives an admin the invitations tab too', () => {
    open({}, 'admin');
    expect(page.tabOptions().at(-1)?.value).toBe('invites');
    expect(page.canOpenRow({ _id: 'kid' })).toBe(true);
  });

  it('opens on the list named in the address, and writes a tab change back to it', () => {
    open({ lista: TAB_KEYS.everyone });
    expect(page.activeTab()).toBe('everyone');
    page.selectTab('casual');
    fixture.detectChanges();
    expect(page.activeTab()).toBe('casual');
    expect(navigate.mock.calls[0][1]).toMatchObject({ queryParams: { lista: 'tobbiek' } });
  });

  it('searches by name or e-mail, ignoring case', () => {
    open();
    page.search.set('KATA');
    expect(page.filteredClubMembers().map((u) => u._id)).toEqual(['kid']);
    page.search.set('vera@');
    expect(page.filteredCasualUsers().map((u) => u._id)).toEqual(['guest']);
    expect(page.filteredEveryone().map((u) => u._id)).toEqual(['guest']);
  });

  it('knows which years are paid, unpaid, or before someone joined', () => {
    open();
    expect(page.yearState('me', Y)).toBe('paid');
    expect(page.yearState('me', Y - 1)).toBe('unpaid');
    expect(page.yearState('me', Y - 2)).toBe('na');
    expect(page.historyFraction('me')).toBe('1/2');
    expect(page.historyFraction('kid')).toBe('0/1');
    expect(page.paymentFor('me', Y)?.payment).toBe('pay1');
    expect(page.myStatusSummary()).toBe('1 év befizetése hiányzik');
    expect(page.currentMembershipYear()).toBe(Y);
    expect(page.clubExtraColumns()[0].header).toBe(String(Y));
  });

  it('opens only my own row for a member', () => {
    open();
    page.toggleDetail('kid');
    expect(page.expandedMemberId()).toBeNull();
    page.toggleDetail('me');
    expect(page.isExpanded('me')).toBe(true);
    page.toggleDetail('me');
    expect(page.isExpanded('me')).toBe(false);
  });

  it('formats money and initials', () => {
    open();
    expect(page.money(5000)).toBe('5000 Ft');
    expect(page.money(12, 'EUR')).toBe('12 €');
    expect(page.initials('Teszt Elek')).toBe('TE');
    expect(page.initials('cher')).toBe('C');
    expect(page.initials('  ')).toBe('?');
  });

  it('says so when there is nothing to pay or I am not a member', () => {
    open({}, 'member', {
      ...loaded(),
      'GET /finance/transactions': {
        data: { transactions: [dues('me', Y), dues('me', Y - 1), dues('kid', Y)] },
      },
    });
    expect(page.myStatusSummary()).toBe('Minden tagdíjad rendezve');
    expect(page.hasUnpaidDues()).toBe(false);
    page.openPayConfirm();
    expect(page.showPayConfirm()).toBe(false);

    page.users.set([]);
    expect(page.myStatusSummary()).toBe('Tagsági állapot');
  });

  it('still opens when the lists cannot be loaded', () => {
    open({}, 'member', {
      'GET /settings/membership-fees': fail(),
      'GET /membership/users': fail(),
      'GET /finance/transactions': fail(),
    });
    expect(page.loading()).toBe(false);
    expect(page.users()).toEqual([]);
  });

  describe('paying the fees of my family online', () => {
    beforeEach(() => open());

    it('lists what is unpaid in my family, all ticked at first', () => {
      expect(page.payBreakdown().map((r) => r.id)).toEqual([`me:${Y - 1}`, `kid:${Y}`]);
      expect(page.payingOnlyForFamily()).toBe(false);
      page.openPayConfirm();
      expect(page.showPayConfirm()).toBe(true);
      expect(page.selectedPayTotal()).toBe(10000);

      page.togglePaySelection(`kid:${Y}`);
      expect(page.selectedPayTotal()).toBe(5000);
      page.togglePaySelection(`kid:${Y}`);
      page.selectedPayFee.set(200);
      expect(page.selectedPayGrandTotal()).toBe(10200);
    });

    it('needs a payment method and at least one ticked row', () => {
      page.openPayConfirm();
      page.confirmPay();
      http.expectNone(`${API}/payments/membership/start`);
      expect(page.payMethodName()).toBe('');

      page.payMethod.set('barion');
      expect(page.payMethodName()).toBe('Barion');
      page.selectedPayIds.set(new Set());
      page.confirmPay();
      http.expectNone(`${API}/payments/membership/start`);
    });

    it('starts the payment and goes over to the provider', () => {
      page.openPayConfirm();
      page.payMethod.set('stripe');
      page.togglePaySelection(`kid:${Y}`);
      page.confirmPay();
      page.closePayConfirm(); // not while the payment is starting
      expect(page.showPayConfirm()).toBe(true);

      const req = http.expectOne(`${API}/payments/membership/start`);
      expect(req.request.body).toEqual({
        items: [{ userId: 'me', year: Y - 1 }],
        method: 'stripe',
      });
      req.flush({ data: { gatewayUrl: `${window.location.href}#fizetes`, paymentId: 'p9' } });
      expect(window.location.hash).toBe('#fizetes');
      window.location.hash = '';
    });

    it('shows the reason when the payment cannot start', () => {
      page.openPayConfirm();
      page.payMethod.set('stripe');
      page.confirmPay();
      respond({ 'POST /payments/membership/start': fail(400, 'A fizetés most nem érhető el.') });
      expect(page.paymentNotice()).toEqual({
        kind: 'error',
        text: 'A fizetés most nem érhető el.',
      });
      expect(page.paying()).toBe(false);
      expect(page.showPayConfirm()).toBe(false);
    });

    it('is "only for the family" when my own fees are all paid', () => {
      respond({});
      page['paidTransactions'].update((map) =>
        new Map(map).set(`me:${Y - 1}`, dues('me', Y - 1) as never),
      );
      expect(page.payingOnlyForFamily()).toBe(true);
    });
  });

  describe('coming back from the payment provider', () => {
    it('confirms a successful payment and reloads the fees', () => {
      open({ paymentId: 'p9' }, 'member', {
        ...loaded(),
        'GET /payments/p9/status': { data: { status: 'Succeeded', amount: 5000 } },
      });
      expect(page.paymentNotice()?.kind).toBe('success');
    });

    it('tells when the payment was not completed', () => {
      open({ paymentId: 'p9' }, 'member', {
        ...loaded(),
        'GET /payments/p9/status': { data: { status: 'Canceled', amount: 5000 } },
      });
      expect(page.paymentNotice()?.text).toContain('nem fejeződött be');
    });

    it('tells when the state could not be asked', () => {
      open({ paymentId: 'p9' }, 'member', { ...loaded(), 'GET /payments/p9/status': fail() });
      expect(page.paymentNotice()?.text).toContain('nem sikerült lekérdezni');
    });
  });

  describe('cash payments (admin)', () => {
    const click = { stopPropagation: vi.fn() } as unknown as Event;

    beforeEach(() => open({}, 'admin'));

    it('can tick an unpaid year or untick a cash one, but not an online payment', () => {
      expect(page.canToggleCash('me', Y)).toBe(true); // paid in cash
      expect(page.canToggleCash('me', Y - 1)).toBe(true); // unpaid
      expect(page.canToggleCash('me', Y - 2)).toBe(false); // not a member yet
      expect(page.paidInCash('kid', Y)).toBe(false);
    });

    it('records a cash payment', () => {
      page.toggleCashDues(USERS[1], Y, click);
      page.toggleCashDues(USERS[0], Y, click); // one at a time
      const req = http.expectOne(`${API}/payments/cash-membership`);
      expect(req.request.body).toEqual({ userId: 'kid', year: Y });
      req.flush({ status: 'success' });
      expect(success).toHaveBeenCalledWith(`Teszt Kata ${Y}. évi tagdíja készpénzben befizetve.`);
      expect(page.cashBusy()).toBeNull();
      http.expectOne(`${API}/finance/transactions`);
    });

    it('takes a cash payment back', () => {
      page.toggleCashDues(USERS[0], Y, click);
      const req = http.expectOne(`${API}/payments/pay1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      expect(success).toHaveBeenCalledWith(`Teszt Elek ${Y}. évi készpénzes tagdíja visszavonva.`);
    });

    it('reports a failure', () => {
      page.toggleCashDues(USERS[1], Y, click);
      respond({ 'POST /payments/cash-membership': fail(400, 'Már befizette.') });
      expect(error).toHaveBeenCalledWith('Már befizette.');
      expect(page.cashBusy()).toBeNull();
    });
  });

  describe('suspending a user (admin)', () => {
    beforeEach(() => open({}, 'admin'));

    it('suspends only after a yes', async () => {
      const confirm = TestBed.inject(ConfirmService);
      void page.archive(USERS[3]);
      confirm.answer(false);
      await settle();
      http.expectNone(`${API}/users/guest`);

      void page.archive(USERS[3]);
      confirm.answer(true);
      await settle();
      const req = http.expectOne(`${API}/users/guest`);
      expect(req.request.method).toBe('DELETE');
      void page.archive(USERS[1]); // one at a time
      page.restore(USERS[1]);
      req.flush(null);
      expect(page.users().find((u) => u._id === 'guest')?.retired).toBe(true);
      expect(success).toHaveBeenCalledWith('Vendég Vera felfüggesztve');
    });

    it('restores at once', () => {
      page.restore(USERS[3]);
      respond({ 'PATCH /users/guest/restore': {} });
      expect(page.users().find((u) => u._id === 'guest')?.retired).toBe(false);
      expect(success).toHaveBeenCalledWith('Vendég Vera visszaállítva');
    });

    it('reports a failure', () => {
      page.restore(USERS[3]);
      respond({ 'PATCH /users/guest/restore': fail() });
      expect(error).toHaveBeenCalledWith('Nem sikerült módosítani a felhasználó állapotát.');
      expect(page.archivingId()).toBeNull();
    });
  });
});

describe('userStatus and sortUsers', () => {
  const anna = user({ _id: 'a', name: 'Anna', lastLoginAt: 'x', toursAttended: 5, age: 40 });
  const bela = user({ _id: 'b', name: 'Béla', email: 'b@x.hu', toursAttended: 9, age: null });
  const cili = user({ _id: 'c', name: 'Cili', toursAttended: 5, age: 30 });
  const dani = user({ _id: 'd', name: 'Dani', retired: true, lastLoginAt: 'x', age: null });
  const all = [dani, cili, bela, anna];
  const ids = (users: MemberUser[]) => users.map((u) => u._id).join('');

  it('tells active, inactive, account-less and suspended users apart', () => {
    expect([anna, bela, cili, dani].map(userStatus)).toEqual([
      'active',
      'inactive',
      'noAccount',
      'retired',
    ]);
  });

  it('sorts by name in Hungarian order', () => {
    expect(ids(sortUsers(all, { key: 'name', dir: 'asc' }))).toBe('abcd');
    expect(ids(sortUsers(all, { key: 'name', dir: 'desc' }))).toBe('dcba');
  });

  it('sorts by camps, ties by name', () => {
    expect(ids(sortUsers(all, { key: 'toursAttended', dir: 'desc' }))).toBe('bacd');
    expect(ids(sortUsers(all, { key: 'toursAttended', dir: 'asc' }))).toBe('dacb');
  });

  it('sorts by age with the unknown ages always last', () => {
    expect(ids(sortUsers(all, { key: 'age', dir: 'asc' }))).toBe('cabd');
    expect(ids(sortUsers(all, { key: 'age', dir: 'desc' }))).toBe('acbd');
  });

  it('sorts by status', () => {
    expect(ids(sortUsers(all, { key: 'status', dir: 'asc' }))).toBe('abcd');
    expect(ids(sortUsers(all, { key: 'status', dir: 'desc' }))).toBe('dcba');
  });
});

describe('PeopleTable', () => {
  let fixture: ComponentFixture<PeopleTable>;
  let table: PeopleTable;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PeopleTable], providers: [pageTesting()] });
    fixture = TestBed.createComponent(PeopleTable);
    table = fixture.componentInstance;
    fixture.componentRef.setInput('people', USERS);
    fixture.detectChanges();
  });

  it('shows the people sorted by name', () => {
    expect(table.sorted().map((u) => u.name)).toEqual([
      'Admin Anna',
      'Teszt Elek',
      'Teszt Kata',
      'Vendég Vera',
    ]);
    expect(table.columnCount()).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Vendég Vera');
  });

  it('adds the optional columns', () => {
    fixture.componentRef.setInput('showAge', true);
    fixture.componentRef.setInput('showStatus', true);
    fixture.componentRef.setInput('showActions', true);
    fixture.detectChanges();
    expect(table.sortColumns().map((c) => c.key)).toEqual([
      'name',
      'toursAttended',
      'age',
      'status',
    ]);
    expect(table.columnCount()).toBe(5);
  });

  it('turns the order around on a second click, and starts numbers from the top', () => {
    expect(table.ariaSort('name')).toBe('ascending');
    expect(table.arrow('name')).toBe('▲');
    table.sortBy('name');
    expect(table.ariaSort('name')).toBe('descending');
    expect(table.arrow('name')).toBe('▼');

    table.sortBy('toursAttended');
    expect(table.isSortedBy('toursAttended')).toBe(true);
    expect(table.ariaSort('toursAttended')).toBe('descending');
    expect(table.ariaSort('name')).toBe('none');
    table.sortBy('status');
    expect(table.ariaSort('status')).toBe('ascending');
  });

  it('labels the status of a user', () => {
    const labels = [
      user({ _id: '1', name: 'a', lastLoginAt: 'x' }),
      user({ _id: '2', name: 'b', email: 'x' }),
      user({ _id: '3', name: 'c' }),
      user({ _id: '4', name: 'd', retired: true }),
    ].map((u) => table.statusLabel(u));
    expect(labels).toEqual(['✓ Aktív', '○ Inaktív', '— Nincs fiókja', 'Felfüggesztett']);
    expect(table.status(USERS[2])).toBe('active');
  });

  it('emits a row click only for rows that may be opened', () => {
    const clicked: string[] = [];
    table.rowClick.subscribe((u) => clicked.push(u._id));
    table.onRowClick(USERS[0]);
    expect(clicked).toEqual([]);

    fixture.componentRef.setInput('rowClickable', (u: MemberUser) => u._id === 'me');
    table.onRowClick(USERS[0]);
    table.onRowClick(USERS[1]);
    expect(clicked).toEqual(['me']);

    fixture.componentRef.setInput('rowClickable', true);
    expect(table.canClick(USERS[1])).toBe(true);
  });
});

describe('InvitationsPanel', () => {
  let fixture: ComponentFixture<InvitationsPanel>;
  let panel: InvitationsPanel;
  let http: HttpTestingController;
  let confirm: ConfirmService;
  let success: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  const person = (over: Partial<InvitationPerson> & { _id: string }): InvitationPerson => ({
    name: `Ember ${over._id}`,
    email: `${over._id}@x.hu`,
    role: 'member',
    status: 'none',
    sentAt: null,
    expiresAt: null,
    sentByName: null,
    ...over,
  });
  const PEOPLE = [
    person({ _id: 'a' }),
    person({ _id: 'b', role: 'admin' }),
    person({ _id: 'c', role: 'guest' }),
    person({ _id: 'd', status: 'sent' }),
    person({ _id: 'e', status: 'expired' }),
    person({ _id: 'f', status: 'joined' }),
  ];
  const list = (intro = 'Szia!') => ({
    'GET /users/invitations': { data: { enabled: true, days: 14, intro, people: PEOPLE } },
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [InvitationsPanel], providers: [pageTesting()] });
    http = TestBed.inject(HttpTestingController);
    confirm = TestBed.inject(ConfirmService);
    const notifications = TestBed.inject(NotificationsService);
    success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
    error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
    fixture = TestBed.createComponent(InvitationsPanel);
    panel = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  it('counts who is waiting, invited, expired and joined', () => {
    respond(list());
    fixture.detectChanges();
    expect(panel.loading()).toBe(false);
    expect(panel.days()).toBe(14);
    expect(panel.membersWaiting()).toBe(2);
    expect(panel.othersWaiting()).toBe(1);
    expect(panel.counts()).toEqual({ none: 3, sent: 1, expired: 1, joined: 1 });
    expect(panel.intro()).toBe('Szia!');
    expect(panel.roleNames.guest).toBe('Vendég');
  });

  it('reports a failed load', () => {
    respond({ 'GET /users/invitations': fail() });
    expect(panel.loading()).toBe(false);
    expect(error).toHaveBeenCalledWith('A meghívók betöltése nem sikerült.');
  });

  it('invites a whole group after a yes, and lists who could not be reached', async () => {
    respond(list());
    void panel.sendBatch('others');
    expect(confirm.pending()?.message).toContain('1 ember');
    confirm.answer(false);
    await settle();
    http.expectNone(`${API}/users/invitations`);

    void panel.sendBatch('members');
    expect(confirm.pending()?.message).toContain('2 ember');
    expect(confirm.pending()?.detail).toContain('14 napig');
    confirm.answer(true);
    await settle();
    expect(panel.busy()).toBe('members');
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ group: 'members' });
    req.flush({ data: { sent: ['a'], failed: [{ name: 'Ember b', message: 'rossz cím' }] } });
    expect(success).toHaveBeenCalledWith('Meghívó elküldve: 1 ember.');
    expect(error).toHaveBeenCalledWith('Ember b: rossz cím');
    expect(panel.busy()).toBeNull();
    respond(list());
  });

  it('invites one person, warning that a new link replaces the old one', async () => {
    respond(list());
    void panel.sendOne(PEOPLE[3]);
    expect(confirm.pending()?.title).toBe('Új meghívó');
    expect(confirm.pending()?.detail).toContain('érvényét veszti');
    confirm.answer(true);
    await settle();
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ userIds: ['d'] });
    req.flush({ data: { sent: [], failed: [] } });
    expect(success).toHaveBeenCalledWith('Nincs kinek küldeni.');
    respond(list());

    void panel.sendOne(PEOPLE[0]);
    expect(confirm.pending()?.title).toBe('Meghívás');
    confirm.answer(true);
    await settle();
    respond({ 'POST /users/invitations': fail(500, 'Nincs SMTP.') });
    expect(error).toHaveBeenCalledWith('Nincs SMTP.');
  });

  it('revokes an invitation after a yes', async () => {
    respond(list());
    void panel.revoke(PEOPLE[3]);
    confirm.answer(false);
    await settle();
    http.expectNone(`${API}/users/d/invitation`);

    void panel.revoke(PEOPLE[3]);
    confirm.answer(true);
    await settle();
    respond({ 'DELETE /users/d/invitation': {} });
    expect(success).toHaveBeenCalledWith('Meghívó visszavonva.');
    respond(list());

    void panel.revoke(PEOPLE[3]);
    confirm.answer(true);
    await settle();
    respond({ 'DELETE /users/d/invitation': fail() });
    expect(error).toHaveBeenCalledWith('A visszavonás nem sikerült.');
    expect(panel.busy()).toBeNull();
  });

  it('edits the text of the invitation, and keeps a half-written one over a reload', () => {
    respond(list());
    panel.intro.set('Kedves barátunk! ');
    expect(panel.introDirty()).toBe(true);
    panel.resetIntro();
    expect(panel.introDirty()).toBe(false);

    panel.intro.set('Kedves barátunk! ');
    panel['load']();
    respond(list('Másik szöveg'));
    expect(panel.intro()).toBe('Kedves barátunk! ');

    panel.saveIntro();
    panel.saveIntro();
    const req = http.expectOne(`${API}/users/invitations/intro`);
    expect(req.request.body).toEqual({ intro: 'Kedves barátunk!' });
    req.flush({ data: { intro: 'Kedves barátunk!' } });
    expect(success).toHaveBeenCalledWith('A meghívó szövege mentve.');
    expect(panel.introDirty()).toBe(false);

    panel.saveIntro();
    respond({ 'PUT /users/invitations/intro': fail() });
    expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
  });

  it('sends a test invitation with the text as it stands', () => {
    respond(list());
    panel.intro.set('Próba');
    panel.sendTest();
    panel.sendTest();
    const req = http.expectOne(`${API}/users/invitations/test`);
    expect(req.request.body).toEqual({ intro: 'Próba' });
    req.flush({ data: { sentTo: 'a@b.hu' } });
    expect(success).toHaveBeenCalledWith('Próba e-mail elküldve: a@b.hu');

    panel.sendTest();
    respond({ 'POST /users/invitations/test': fail() });
    expect(error).toHaveBeenCalledWith('A küldés nem sikerült.');
  });
});
