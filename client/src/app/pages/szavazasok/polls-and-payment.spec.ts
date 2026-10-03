import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { API } from '../../../testing/http';
import { FakeSocket, fail, logIn, pageTesting, respond } from '../../../testing/component';
import { makePayment, makeTour, tourResponse } from '../../../testing/fixtures';
import { NotificationsService } from '../../notifications/notifications.service';
import { PollCard } from '../../components/poll-card/poll-card';
import { PollCreate } from '../../components/poll-create/poll-create';
import { Poll } from '../../services/poll';
import { TourSocketService } from '../../services/tour-socket';
import { PayProviderPicker } from '../../shared/pay-provider-picker/pay-provider-picker';
import { Payment } from '../payment/payment';
import { Szavazasok } from './szavazasok';

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

const poll = (over: Partial<Poll> = {}): Poll => ({
  _id: 'p1',
  tour: null,
  question: 'Hova menjünk?',
  awaitsMyVote: true,
  details: '',
  options: [
    { _id: 'o1', text: 'Mátra' },
    { _id: 'o2', text: 'Bükk' },
  ],
  closesAt: tomorrow(),
  isClosed: false,
  hasVoted: false,
  myOptionId: null,
  visibility: 'open',
  minimum: null,
  post: null,
  createdBy: { _id: 'me', name: 'Teszt Elek' },
  canManage: true,
  totalVotes: null,
  results: null,
  createdAt: '2026-01-01',
  ...over,
});

const voted = (over: Partial<Poll> = {}) =>
  poll({
    awaitsMyVote: false,
    hasVoted: true,
    myOptionId: 'o1',
    totalVotes: 3,
    results: [
      {
        _id: 'o1',
        text: 'Mátra',
        count: 2,
        percentage: 67,
        voters: [
          { _id: 'a', name: 'Anna' },
          { _id: 'b', name: 'Béla' },
        ],
      },
      { _id: 'o2', text: 'Bükk', count: 1, percentage: 33 },
    ],
    ...over,
  });

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

describe('PollCard', () => {
  let fixture: ComponentFixture<PollCard>;
  let card: PollCard;
  let changes: Poll[];
  const pending = { 'GET /polls/pending': { data: { count: 0 } } };

  function open(inputs: Record<string, unknown>) {
    setUp();
    fixture = TestBed.createComponent(PollCard);
    card = fixture.componentInstance;
    fixture.componentRef.setInput('pollId', 'p1');
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    changes = [];
    card.changed.subscribe((p) => changes.push(p));
    fixture.detectChanges();
  }

  it('shows the poll it was given, without asking the server', () => {
    open({ initial: poll() });
    expect(card.poll()?.question).toBe('Hova menjünk?');
    http.expectNone(`${API}/polls/p1`);
    expect(fixture.nativeElement.textContent).toContain('Hova menjünk?');
  });

  it('loads the poll itself when it only has the id (in a chat message)', () => {
    open({});
    respond({ 'GET /polls/p1': { data: { poll: poll() } } });
    fixture.detectChanges();
    expect(card.poll()?._id).toBe('p1');
    expect(changes).toHaveLength(1);
  });

  it('stays empty when the poll cannot be loaded', () => {
    open({});
    respond({ 'GET /polls/p1': fail(404) });
    expect(card.poll()).toBeNull();
    card.vote('o1');
    card.close();
    card.remove();
    http.expectNone((r) => r.method !== 'GET');
  });

  it('reloads on a live update of this poll only', () => {
    open({ initial: poll(), live: true });
    const socket = TestBed.inject(TourSocketService) as unknown as FakeSocket;
    socket.fire('poll-updated', { pollId: 'other' });
    http.expectNone(`${API}/polls/p1`);
    socket.fire('poll-updated', { pollId: 'p1' });
    respond({ 'GET /polls/p1': { data: { poll: voted() } } });
    expect(card.poll()?.totalVotes).toBe(3);
    fixture.destroy();
    expect(socket.handlers.get('poll-updated')).toEqual([]);
  });

  it('votes, and shows the results that come back', () => {
    open({ initial: poll() });
    card.vote('o1');
    card.vote('o2'); // one vote at a time
    const req = http.expectOne(`${API}/polls/p1/vote`);
    expect(req.request.body).toEqual({ optionId: 'o1' });
    req.flush({ data: { poll: voted() } });
    respond(pending);
    fixture.detectChanges();
    expect(card.busy()).toBe(false);
    expect(card.resultFor('o1')?.percentage).toBe(67);
    expect(card.resultFor('nope')).toBeNull();
    expect(card.voterNames(card.resultFor('o1')!)).toBe('Anna, Béla');
    expect(card.voterNames(card.resultFor('o2')!)).toBe('');

    card.vote('o1'); // the same answer again: nothing to send
    http.expectNone(`${API}/polls/p1/vote`);
  });

  it('cannot vote on a closed poll, and reports a refused vote', () => {
    open({ initial: poll({ isClosed: true }) });
    card.vote('o1');
    http.expectNone(`${API}/polls/p1/vote`);

    fixture.componentRef.setInput('initial', poll());
    fixture.detectChanges();
    card.vote('o1');
    respond({ 'POST /polls/p1/vote': fail(400, 'A szavazás lezárult.') });
    expect(error).toHaveBeenCalledWith('A szavazás lezárult.');
    expect(card.busy()).toBe(false);
  });

  it('closes and deletes the poll', () => {
    open({ initial: poll() });
    const removed: string[] = [];
    card.removed.subscribe((id) => removed.push(id));

    card.close();
    card.close();
    respond({ 'POST /polls/p1/close': { data: { poll: poll({ isClosed: true }) } }, ...pending });
    expect(card.poll()?.isClosed).toBe(true);
    card.close();
    respond({ 'POST /polls/p1/close': fail() });
    expect(error).toHaveBeenCalledWith('Nem sikerült lezárni.');

    card.remove();
    respond({ 'DELETE /polls/p1': fail() });
    expect(error).toHaveBeenCalledWith('Nem sikerült törölni.');
    card.remove();
    respond({ 'DELETE /polls/p1': {}, ...pending });
    expect(removed).toEqual(['p1']);
  });

  it('tells how far the wanted headcount is', () => {
    open({ initial: poll() });
    expect(card.minimumText()).toBe('');
    expect(card.minimumPercent()).toBe(0);

    fixture.componentRef.setInput(
      'initial',
      poll({ minimum: { optionId: 'o1', count: 8, current: 6, reached: false } }),
    );
    fixture.detectChanges();
    expect(card.minimumText()).toBe('„Mátra”: 6 / 8 fő – még 2 kell');
    expect(card.minimumPercent()).toBe(75);

    fixture.componentRef.setInput(
      'initial',
      poll({ minimum: { optionId: 'o1', count: 8, current: 9, reached: true } }),
    );
    fixture.detectChanges();
    expect(card.minimumText()).toBe('Összejött! 9 fő – „Mátra”');
    expect(card.minimumPercent()).toBe(100);
  });

  it('names the deadline by weekday when it is near, by date otherwise', () => {
    open({ initial: poll() });
    const near = new Date(Date.now() + 2 * 86_400_000);
    near.setHours(20, 0, 0, 0);
    const weekday = near.toLocaleDateString('hu-HU', { weekday: 'long' });
    expect(card.deadline(near.toISOString())).toBe(`${weekday} 20:00`);
    expect(card.deadline('2020-03-05T18:30:00')).toBe('márc. 5. 18:30');
  });

  it('keeps the trusted details HTML until the text changes', () => {
    open({ initial: poll() });
    const first = card.detailsHtml('<p>a</p>');
    expect(card.detailsHtml('<p>a</p>')).toBe(first);
    expect(card.detailsHtml('<p>b</p>')).not.toBe(first);
  });
});

describe('PollCreate', () => {
  let fixture: ComponentFixture<PollCreate>;
  let form: PollCreate;
  let saved: Poll[];
  let closed: number;
  const submit = () => form.submit(new Event('submit'));
  /** The editor is loaded on demand - wait until it is there. */
  const editorReady = () =>
    vi.waitFor(() => expect((form as unknown as { quill?: unknown }).quill).toBeDefined());

  function open(inputs: Record<string, unknown> = {}) {
    setUp();
    fixture = TestBed.createComponent(PollCreate);
    form = fixture.componentInstance;
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    saved = [];
    closed = 0;
    form.saved.subscribe((p) => saved.push(p));
    form.closed.subscribe(() => closed++);
    fixture.detectChanges();
  }

  it('starts with Igen/Nem and a deadline tomorrow at eight in the evening', () => {
    open();
    expect(form.options()).toEqual(['Igen', 'Nem']);
    const deadline = new Date(form.closesAt());
    expect(deadline.getHours()).toBe(20);
    expect(deadline.getTime()).toBeGreaterThan(Date.now());
  });

  it('edits the answers, keeping at least two', () => {
    open();
    form.addOption();
    form.setOption(2, 'Talán');
    expect(form.options()).toEqual(['Igen', 'Nem', 'Talán']);
    form.removeOption(0);
    form.removeOption(0); // two must stay
    expect(form.options()).toEqual(['Nem', 'Talán']);
  });

  it('refuses a poll without a question, with one answer, or closing in the past', () => {
    open();
    submit();
    expect(form.error()).toBe('Írd be a kérdést.');
    form.question.set('Jössz?');
    form.options.set(['Igen', '  ']);
    submit();
    expect(form.error()).toBe('Legalább 2 válasz kell.');
    form.options.set(['Igen', 'Nem']);
    form.closesAt.set('2020-01-01T10:00');
    submit();
    expect(form.error()).toBe('A lezárás időpontja a jövőben legyen.');
    form.closesAt.set('nem dátum');
    submit();
    expect(form.error()).toBe('A lezárás időpontja a jövőben legyen.');
    http.expectNone((r) => r.method === 'POST');
  });

  it('creates a poll in the general chat', () => {
    open();
    form.question.set(' Jössz? ');
    form.visibility.set('secret');
    submit();
    const req = http.expectOne(`${API}/chat-rooms/general/polls`);
    expect(req.request.body).toMatchObject({
      question: 'Jössz?',
      details: '',
      options: ['Igen', 'Nem'],
      visibility: 'secret',
      minimumCount: null,
    });
    form.cancel(); // not while saving
    expect(closed).toBe(0);
    req.flush({ data: { poll: poll() } });
    expect(saved).toHaveLength(1);
    expect(closed).toBe(1);
  });

  it("creates a poll in a tour's chat", () => {
    open({ tourId: 't1' });
    form.question.set('Jössz?');
    submit();
    http.expectOne(`${API}/tours/t1/polls`);
  });

  it('creates a poll from the polls page, for the chosen place', () => {
    open({ tours: [makeTour()] });
    form.question.set('Jössz?');
    form.place.set('t1');
    submit();
    const req = http.expectOne(`${API}/polls`);
    expect(req.request.body.tour).toBe('t1');
  });

  it('edits an existing poll, keeping its headcount', () => {
    const existing = poll({
      tour: { _id: 't1', title: 'Mátra', slug: 'matra', order: 12 },
      visibility: 'secret',
      minimum: { optionId: 'o1', count: 8, current: 2, reached: false },
    });
    open({ poll: existing });
    expect(form.question()).toBe('Hova menjünk?');
    expect(form.options()).toEqual(['Mátra', 'Bükk']);
    expect(form.place()).toBe('t1');
    expect(form.visibility()).toBe('secret');

    submit();
    const req = http.expectOne(`${API}/polls/p1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toMatchObject({ tour: 't1', minimumCount: 8 });
    req.flush({ message: 'Már szavaztak rá.' }, { status: 400, statusText: 'Bad Request' });
    expect(form.error()).toBe('Már szavaztak rá.');
    expect(form.saving()).toBe(false);
    form.cancel();
    expect(closed).toBe(1);
  });

  it('sends the details written in the editor, and nothing when it is switched off', async () => {
    open();
    form.question.set('Jössz?');
    form.setWithDetails(true);
    await editorReady();
    const quill = (form as unknown as { quill: { insertText(i: number, t: string): void } }).quill;
    quill.insertText(0, 'Busszal megyünk.');
    submit();
    const req = http.expectOne(`${API}/chat-rooms/general/polls`);
    expect(req.request.body.details).toContain('megyünk.');
    req.flush({ data: { poll: poll() } });

    form.setWithDetails(false);
    submit();
    expect(http.expectOne(`${API}/chat-rooms/general/polls`).request.body.details).toBe('');
  });

  it('opens the editor with the saved details of a poll', async () => {
    open({ poll: poll({ details: '<p>Busszal megyünk.</p>' }) });
    await editorReady();
    expect(form.withDetails()).toBe(true);
    const quill = (form as unknown as { quill: { getText(): string } }).quill;
    expect(quill.getText()).toContain('Busszal megyünk.');
  });
});

describe('Szavazasok', () => {
  let fixture: ComponentFixture<Szavazasok>;
  let page: Szavazasok;
  const POLLS = [
    poll({ _id: 'wait' }),
    poll({ _id: 'open', awaitsMyVote: false }),
    poll({ _id: 'done', awaitsMyVote: false, isClosed: true }),
  ];

  function open(reply: object = { data: { polls: POLLS } }) {
    setUp();
    logIn({ role: 'admin' });
    fixture = TestBed.createComponent(Szavazasok);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /polls': reply, 'GET /polls/pending': { data: { count: 1 } } });
    fixture.detectChanges();
  }

  it('sorts the polls into waiting for me, open and closed', () => {
    open();
    expect(page.loading()).toBe(false);
    expect(page.sections().map((s) => [s.title, s.polls.map((p) => p._id)])).toEqual([
      ['Rád vár', ['wait']],
      ['Nyitott', ['open']],
      ['Lezárt', ['done']],
    ]);
    expect(page.isAdmin()).toBe(true);
  });

  it('reports a failed load', () => {
    open(fail());
    expect(error).toHaveBeenCalledWith('A voks betöltése nem sikerült.');
    expect(page.loading()).toBe(false);
  });

  it('follows a vote, a removal and a new poll', () => {
    open();
    page.onChanged(poll({ _id: 'wait', awaitsMyVote: false }));
    expect(page.sections()[0].polls).toEqual([]);
    http.expectOne(`${API}/polls/pending`);

    page.onRemoved('done');
    expect(page.polls().map((p) => p._id)).toEqual(['wait', 'open']);

    page.openCreate();
    expect(page.showForm()).toBe(true);
    respond({ 'GET /tours': { data: { tours: [makeTour()] } } });
    page.onSaved(poll({ _id: 'new' }));
    expect(page.polls()[0]._id).toBe('new');
    expect(success).toHaveBeenCalledWith('Szavazás létrehozva');
  });

  it('edits a poll, loading the tours only once', () => {
    open();
    page.openEdit(POLLS[1]);
    respond({ 'GET /tours': { data: { tours: [makeTour()] } } });
    page.openEdit(POLLS[1]);
    http.expectNone(`${API}/tours`);
    page.onSaved(poll({ _id: 'open', question: 'Átírva' }));
    expect(page.polls().find((p) => p._id === 'open')?.question).toBe('Átírva');
    expect(success).toHaveBeenCalledWith('Szavazás mentve');
  });

  it('reports tours that cannot be loaded', () => {
    open();
    page.openCreate();
    respond({ 'GET /tours': fail() });
    expect(error).toHaveBeenCalledWith('A táborok betöltése nem sikerült.');
  });
});

describe('Payment', () => {
  let fixture: ComponentFixture<Payment>;
  let page: Payment;

  const PAYMENTS = [
    makePayment({ attendeeId: 'a-me', advance: 6000 }),
    makePayment({ attendeeId: 'a-kid', name: 'Teszt Kata', userId: 'kid', advance: 4000 }),
    makePayment({ attendeeId: 'a-paid', userId: 'wife', paid: true }),
    makePayment({ attendeeId: 'a-free', userId: 'gran', advance: null }),
    makePayment({ attendeeId: 'a-other', userId: 'x', familyId: 'f9' }),
  ];
  const methods = {
    data: {
      stripe: { enabled: false, feePercent: 2, feeFixed: 0, feeMin: 0 },
      barion: { enabled: true, feePercent: 0, feeFixed: 0, feeMin: 100 },
    },
  };

  function open(query: Record<string, string> = {}, over: Record<string, object> = {}) {
    setUp([
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ id: 't1' }),
            queryParamMap: convertToParamMap(query),
          },
        },
      },
    ]);
    logIn({ id: 'me', role: 'member', familyId: 'f1' });
    fixture = TestBed.createComponent(Payment);
    page = fixture.componentInstance;
    fixture.detectChanges();
    const routes = {
      'GET /tours/t1': tourResponse(makeTour(), { attendeePayments: PAYMENTS }),
      'GET /settings/payment-methods': methods,
      ...over,
    };
    respond(routes);
    fixture.detectChanges();
    respond(routes);
    fixture.detectChanges();
  }

  it("lists my family's unpaid advances, all ticked", () => {
    open();
    expect(page.loading()).toBe(false);
    expect(page.tourTitle()).toBe('Mátra');
    expect(page.myGroup().map((p) => p.attendeeId)).toEqual(['a-me', 'a-kid']);
    expect(page.totalToPay()).toBe(10000);
    expect(page.isSelected('a-kid')).toBe(true);
  });

  it('picks the first enabled provider and adds its fee', () => {
    open();
    expect(page.method()).toBe('barion');
    expect(page.methodName()).toBe('Barion');
    expect(page.fee()).toBe(100);
    expect(page.grandTotalToPay()).toBe(10100);
    expect(page.canPay()).toBe(true);
  });

  it('pays only for the ticked people', () => {
    open();
    page.toggleSelected('a-kid');
    expect(page.totalToPay()).toBe(6000);
    page.pay();
    const req = http.expectOne(`${API}/payments/start`);
    expect(req.request.body).toEqual({ tourId: 't1', attendeeIds: ['a-me'], method: 'barion' });
    page.pay(); // already starting
    req.flush({ data: { gatewayUrl: `${window.location.href}#eloleg`, paymentId: 'p9' } });
    expect(window.location.hash).toBe('#eloleg');
    window.location.hash = '';
  });

  it('cannot pay with nobody ticked, and shows why a payment did not start', () => {
    open();
    page.toggleSelected('a-me');
    page.toggleSelected('a-kid');
    expect(page.canPay()).toBe(false);
    page.pay();
    http.expectNone(`${API}/payments/start`);

    page.toggleSelected('a-me');
    page.pay();
    respond({ 'POST /payments/start': fail(400, 'Már befizetted.') });
    expect(page.error()).toBe('Már befizetted.');
    expect(page.starting()).toBe(false);
  });

  it('shows the result when coming back from the provider', () => {
    open(
      { paymentId: 'p9' },
      { 'GET /payments/p9/status': { data: { status: 'Succeeded', amount: 1 } } },
    );
    expect(page.resultStatus()).toBe('Succeeded');
    expect(page.checkingResult()).toBe(false);
  });

  it('says so when the result or the tour cannot be loaded', () => {
    open({ paymentId: 'p9' }, { 'GET /payments/p9/status': fail() });
    expect(page.error()).toBe('A fizetés állapotát nem sikerült lekérdezni.');

    TestBed.resetTestingModule();
    open({}, { 'GET /tours/t1': fail() });
    expect(page.error()).toBe('A tábor betöltése nem sikerült.');
    expect(page.loading()).toBe(false);
    expect(page.methodName()).toBe('');
  });
});

describe('PayProviderPicker', () => {
  let fixture: ComponentFixture<PayProviderPicker>;
  let picker: PayProviderPicker;

  function open(reply: object, wallet = 'tour') {
    setUp();
    fixture = TestBed.createComponent(PayProviderPicker);
    picker = fixture.componentInstance;
    fixture.componentRef.setInput('subtotal', 10000);
    fixture.componentRef.setInput('wallet', wallet);
    fixture.detectChanges();
    respond({ 'GET /settings/payment-methods': reply });
    fixture.detectChanges();
  }
  const method = (over = {}) => ({ enabled: true, feePercent: 2, feeFixed: 0, feeMin: 0, ...over });

  it('offers the enabled providers with their fee, the first one picked', () => {
    open({ data: { stripe: method(), barion: method({ feePercent: 0, feeMin: 150 }) } });
    expect(picker.loaded()).toBe(true);
    expect(picker.providers().map((p) => [p.key, p.enabled, p.fee])).toEqual([
      ['stripe', true, 204],
      ['barion', true, 150],
    ]);
    expect(picker.selected()).toBe('stripe');
    expect(picker.fee()).toBe(204);

    picker.selected.set('barion');
    fixture.detectChanges();
    expect(picker.fee()).toBe(150);
  });

  it('leaves out a provider that is off for this kind of payment', () => {
    open(
      {
        data: { stripe: method({ wallets: { membership: false, tour: true } }), barion: method() },
      },
      'membership',
    );
    expect(picker.providers().map((p) => p.enabled)).toEqual([false, true]);
    expect(picker.selected()).toBe('barion');
  });

  it('has nothing to offer when none is enabled or the settings cannot be loaded', () => {
    open({ data: { stripe: method({ enabled: false }), barion: method({ enabled: false }) } });
    expect(picker.selected()).toBeNull();
    expect(picker.fee()).toBe(0);

    TestBed.resetTestingModule();
    open(fail());
    expect(picker.loaded()).toBe(true);
    expect(picker.providers().every((p) => !p.enabled)).toBe(true);
  });
});
