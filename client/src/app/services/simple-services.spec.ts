// The services that are thin wrappers over the API: each test pins down the
// request a method sends, so a renamed route or a changed body shows up here.
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Observable } from 'rxjs';

import { API, formEntries, httpTesting, itSendsRequests } from '../../testing/http';
import { ChatService } from './chat';
import { ClubDocument, ClubDocumentService } from './club-document';
import { DartsService, dartLabel, gameName } from './darts';
import { FinanceService } from './finance';
import { MembershipService } from './membership';
import { PaymentService } from './payment';
import { PollService } from './poll';
import { PaymentMethodSettings, SettingsService, feeForYear, paymentFee } from './settings';
import { UserService } from './user';

let http: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [httpTesting()] });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => http.verify());

describe('ChatService', () => {
  const service = () => TestBed.inject(ChatService);
  const rooms = `${API}/chat-rooms`;

  itSendsRequests([
    ['getOverview', () => service().getOverview(), 'GET', `${rooms}/overview`],
    ['getTourChatRoom', () => service().getTourChatRoom('t1'), 'GET', `${API}/tours/t1/chat-room`],
    ['getGeneralChatRoom', () => service().getGeneralChatRoom(), 'GET', `${rooms}/general`],
    ['getGeneralGame', () => service().getGeneralGame(), 'GET', `${rooms}/general/game`],
    ['getGeneralPeople', () => service().getGeneralPeople(), 'GET', `${rooms}/general/people`],
  ]);

  it('sends a chat photo as foto.jpg with its text', () => {
    service()
      .sendChatImage('r1', new Blob(['x']), 'szia')
      .subscribe();
    const req = http.expectOne(`${rooms}/r1/images`);
    expect(req.request.method).toBe('POST');
    expect(formEntries(req.request.body)).toEqual({ image: 'foto.jpg', text: 'szia' });
    req.flush({});
  });

  it('builds the photo URLs', () => {
    expect(service().chatImageUrl('r1', 'p1')).toBe(`${rooms}/r1/images/p1`);
    expect(service().chatImageThumbUrl('r1', 'p1')).toBe(`${rooms}/r1/images/p1/thumb`);
  });
});

describe('ClubDocumentService', () => {
  const service = () => TestBed.inject(ClubDocumentService);
  const docs = `${API}/documents`;
  const file = new File(['x'], 'alapszabaly.pdf');

  itSendsRequests([
    ['getDocuments', () => service().getDocuments(), 'GET', docs],
    ['delete', () => service().delete('d1'), 'DELETE', `${docs}/d1`],
  ]);

  it('uploads with the year when one is given', () => {
    service().upload('Beszámoló', 'Számlák', 2025, file).subscribe();
    const req = http.expectOne(docs);
    expect(formEntries(req.request.body)).toEqual({
      name: 'Beszámoló',
      category: 'Számlák',
      year: '2025',
      file: 'alapszabaly.pdf',
    });
    req.flush({});
  });

  it('leaves the year out when there is none', () => {
    service().upload('Alapszabály', 'Alapdokumentumok', null, file).subscribe();
    const req = http.expectOne(docs);
    expect(formEntries(req.request.body)).not.toHaveProperty('year');
    req.flush({});
  });

  it('builds the file and preview URLs', () => {
    const doc = { _id: 'd1' } as ClubDocument;
    expect(service().fileUrl(doc)).toBe(`${docs}/d1/file`);
    expect(service().fileUrl(doc, true)).toBe(`${docs}/d1/file?download=1`);
    expect(service().previewUrl('d1')).toBe(`${docs}/d1/preview`);
  });
});

describe('FinanceService and MembershipService', () => {
  const payload = {
    date: '2026-01-01',
    name: 'Tagdíj',
    type: 'income' as const,
    category: 'Tagdíj',
    amount: 5000,
    currency: 'HUF' as const,
  };

  itSendsRequests([
    [
      'getTransactions',
      () => TestBed.inject(FinanceService).getTransactions(),
      'GET',
      `${API}/finance/transactions`,
    ],
    [
      'createTransaction',
      () => TestBed.inject(FinanceService).createTransaction(payload),
      'POST',
      `${API}/finance/transactions`,
      payload,
    ],
    [
      'getMembers',
      () => TestBed.inject(MembershipService).getMembers(),
      'GET',
      `${API}/membership/users`,
    ],
  ]);
});

describe('PaymentService', () => {
  const service = () => TestBed.inject(PaymentService);
  const payments = `${API}/payments`;

  itSendsRequests([
    [
      'startTourAdvancePayment',
      () => service().startTourAdvancePayment('t1', ['a1'], 'barion'),
      'POST',
      `${payments}/start`,
      { tourId: 't1', attendeeIds: ['a1'], method: 'barion' },
    ],
    [
      'startMembershipPayment',
      () => service().startMembershipPayment([{ userId: 'u1', year: 2026 }], 'stripe'),
      'POST',
      `${payments}/membership/start`,
      { items: [{ userId: 'u1', year: 2026 }], method: 'stripe' },
    ],
    [
      'recordCashPayment',
      () => service().recordCashPayment('t1', ['a1']),
      'POST',
      `${payments}/cash`,
      { tourId: 't1', attendeeIds: ['a1'] },
    ],
    [
      'recordCashMembershipPayment',
      () => service().recordCashMembershipPayment('u1', 2026),
      'POST',
      `${payments}/cash-membership`,
      { userId: 'u1', year: 2026 },
    ],
    ['deleteCashPayment', () => service().deleteCashPayment('p1'), 'DELETE', `${payments}/p1`],
    ['getPaymentStatus', () => service().getPaymentStatus('p1'), 'GET', `${payments}/p1/status`],
    [
      'getWithdrawalStatus',
      () => service().getWithdrawalStatus('tourAdvance'),
      'GET',
      `${payments}/withdraw/tourAdvance`,
    ],
    [
      'withdraw',
      () => service().withdraw('membershipFee', 1000),
      'POST',
      `${payments}/withdraw`,
      { purpose: 'membershipFee', amount: 1000 },
    ],
  ]);

  it('builds the receipt URL', () => {
    expect(service().receiptUrl('p1')).toBe(`${payments}/p1/receipt`);
  });
});

describe('PollService', () => {
  const service = () => TestBed.inject(PollService);
  const polls = `${API}/polls`;

  itSendsRequests([
    ['getPolls', () => service().getPolls(), 'GET', polls],
    ['getPoll', () => service().getPoll('p1'), 'GET', `${polls}/p1`],
    [
      'updatePoll',
      () => service().updatePoll('p1', { question: 'Hova?' }),
      'PATCH',
      `${polls}/p1`,
      { question: 'Hova?' },
    ],
  ]);

  it('refreshPending stores how many polls wait for my vote', () => {
    service().refreshPending();
    http.expectOne(`${polls}/pending`).flush({ data: { count: 3 } });
    expect(service().pendingCount()).toBe(3);
  });

  it('refreshPending keeps the old count when the request fails', () => {
    service().pendingCount.set(2);
    service().refreshPending();
    http.expectOne(`${polls}/pending`).flush('', { status: 500, statusText: 'Error' });
    expect(service().pendingCount()).toBe(2);
  });

  // Everything that can change "how many wait for me" re-reads the count.
  it.each([
    ['createPoll', () => service().createPoll({ question: 'q' }), 'POST', polls],
    [
      'createTourPoll',
      () => service().createTourPoll('t1', { question: 'q' }),
      'POST',
      `${API}/tours/t1/polls`,
    ],
    [
      'createGeneralPoll',
      () => service().createGeneralPoll({ question: 'q' }),
      'POST',
      `${API}/chat-rooms/general/polls`,
    ],
    ['closePoll', () => service().closePoll('p1'), 'POST', `${polls}/p1/close`],
    ['deletePoll', () => service().deletePoll('p1'), 'DELETE', `${polls}/p1`],
    ['vote', () => service().vote('p1', 'o1'), 'POST', `${polls}/p1/vote`],
  ] as [string, () => Observable<unknown>, string, string][])(
    '%s refreshes the pending count afterwards',
    (_name, call, method, url) => {
      call().subscribe();
      const req = http.expectOne(url);
      expect(req.request.method).toBe(method);
      req.flush({ data: {} });
      http.expectOne(`${polls}/pending`).flush({ data: { count: 1 } });
      expect(service().pendingCount()).toBe(1);
    },
  );

  it('vote sends the chosen option', () => {
    service().vote('p1', 'o1').subscribe();
    const req = http.expectOne(`${polls}/p1/vote`);
    expect(req.request.body).toEqual({ optionId: 'o1' });
    req.flush({});
    http.expectOne(`${polls}/pending`).flush({ data: { count: 0 } });
  });
});

describe('UserService', () => {
  const service = () => TestBed.inject(UserService);
  const users = `${API}/users`;

  itSendsRequests([
    ['deletePhoto of a user', () => service().deletePhoto('u1'), 'DELETE', `${users}/u1/photo`],
    ['deletePhoto of my own', () => service().deletePhoto(null), 'DELETE', `${users}/me/photo`],
    ['getAllUsers', () => service().getAllUsers(), 'GET', users],
    ['getUser', () => service().getUser('u1'), 'GET', `${users}/u1`],
    ['getMyAttendance', () => service().getMyAttendance(), 'GET', `${users}/me/attendance`],
    ['getMyFamily', () => service().getMyFamily(), 'GET', `${users}/me/family`],
    ['getMe', () => service().getMe(), 'GET', `${users}/me`],
    ['createUser', () => service().createUser({ name: 'Új' }), 'POST', users, { name: 'Új' }],
    [
      'updateUser',
      () => service().updateUser('u1', { name: 'Más' }),
      'PATCH',
      `${users}/u1`,
      { name: 'Más' },
    ],
    [
      'updateMe',
      () => service().updateMe({ username: 'bodri' }),
      'PATCH',
      `${users}/updateMe`,
      { username: 'bodri' },
    ],
    ['archiveUser', () => service().archiveUser('u1'), 'DELETE', `${users}/u1`],
    ['restoreUser', () => service().restoreUser('u1'), 'PATCH', `${users}/u1/restore`, {}],
    [
      'joinFamily',
      () => service().joinFamily(['u1', 'u2']),
      'POST',
      `${users}/join-family`,
      { userIds: ['u1', 'u2'] },
    ],
  ]);

  it('uploads a photo for a user, or for me when no id is given', () => {
    service()
      .uploadPhoto('u1', new Blob(['x']))
      .subscribe();
    const req = http.expectOne(`${users}/u1/photo`);
    expect(req.request.method).toBe('PUT');
    expect(formEntries(req.request.body)).toEqual({ file: 'photo.jpg' });
    req.flush({});

    service()
      .uploadPhoto(null, new Blob(['x']))
      .subscribe();
    http.expectOne(`${users}/me/photo`).flush({});
  });

  it('builds a versioned photo URL', () => {
    expect(service().photoUrl('u1', '2026-01-01T10:00:00Z')).toBe(
      `${users}/u1/photo?v=2026-01-01T10%3A00%3A00Z`,
    );
  });
});

describe('SettingsService', () => {
  const service = () => TestBed.inject(SettingsService);
  const settings = `${API}/settings`;
  const reminder = {
    enabled: true,
    startMonth: 2,
    startDay: 1,
    frequency: 'monthly' as const,
  };
  const wallet = { payeeEmail: 'a@b.hu', withdrawName: 'Klub', withdrawIban: 'HU00' };
  const method: PaymentMethodSettings = { enabled: true, feePercent: 1, feeFixed: 0, feeMin: 0 };
  const birthday = { enabled: true, effect: 'confetti' as never, message: 'Boldog, {név}!' };

  itSendsRequests([
    [
      'getMembershipFees',
      () => service().getMembershipFees(),
      'GET',
      `${settings}/membership-fees`,
    ],
    [
      'updateMembershipFees',
      () => service().updateMembershipFees([{ fromYear: 2020, amount: 5000 }]),
      'PUT',
      `${settings}/membership-fees`,
      { fees: [{ fromYear: 2020, amount: 5000 }] },
    ],
    [
      'getMembershipReminder',
      () => service().getMembershipReminder(),
      'GET',
      `${settings}/membership-reminder`,
    ],
    [
      'updateMembershipReminder',
      () => service().updateMembershipReminder(reminder),
      'PUT',
      `${settings}/membership-reminder`,
      reminder,
    ],
    [
      'testMembershipReminder',
      () => service().testMembershipReminder(),
      'POST',
      `${settings}/membership-reminder/test`,
      {},
    ],
    [
      'getChatImageSettings',
      () => service().getChatImageSettings(),
      'GET',
      `${settings}/chat-images`,
    ],
    [
      'updateChatImageSettings',
      () => service().updateChatImageSettings({ quotaMB: 100, dailyLimit: 5 }),
      'PUT',
      `${settings}/chat-images`,
      { quotaMB: 100, dailyLimit: 5 },
    ],
    [
      'getImageCacheSettings',
      () => service().getImageCacheSettings(),
      'GET',
      `${settings}/image-cache`,
    ],
    [
      'updateImageCacheSettings',
      () => service().updateImageCacheSettings(200),
      'PUT',
      `${settings}/image-cache`,
      { quotaMB: 200 },
    ],
    ['clearImageCache', () => service().clearImageCache(), 'DELETE', `${settings}/image-cache`],
    ['getBarionSettings', () => service().getBarionSettings(), 'GET', `${settings}/barion`],
    [
      'updateBarionWallet',
      () => service().updateBarionWallet('tour', wallet),
      'PUT',
      `${settings}/barion/tour`,
      wallet,
    ],
    [
      'getPaymentMethods',
      () => service().getPaymentMethods(),
      'GET',
      `${settings}/payment-methods`,
    ],
    [
      'updatePaymentMethod',
      () => service().updatePaymentMethod('stripe', method),
      'PUT',
      `${settings}/payment-methods/stripe`,
      method,
    ],
    ['getBirthdaySettings', () => service().getBirthdaySettings(), 'GET', `${settings}/birthday`],
    [
      'updateBirthdaySettings',
      () => service().updateBirthdaySettings(birthday),
      'PUT',
      `${settings}/birthday`,
      birthday,
    ],
    ['getRankSettings', () => service().getRankSettings(), 'GET', `${settings}/rank`],
    [
      'updateRankSettings',
      () => service().updateRankSettings(birthday),
      'PUT',
      `${settings}/rank`,
      birthday,
    ],
    ['getPresident', () => service().getPresident(), 'GET', `${settings}/president`],
    [
      'updatePresident',
      () => service().updatePresident('Elnök Elek'),
      'PUT',
      `${settings}/president`,
      { presidentName: 'Elnök Elek' },
    ],
  ]);

  it('builds the versioned seal URL', () => {
    expect(service().presidentSealUrl('a b')).toBe(`${settings}/president/seal.png?v=a%20b`);
  });
});

describe('feeForYear', () => {
  const fees = [
    { fromYear: 2020, amount: 5000 },
    { fromYear: 2015, amount: 3000 },
    { fromYear: 2024, amount: 8000 },
  ];

  it('takes the latest fee that had started by that year', () => {
    expect(feeForYear(fees, 2015)).toBe(3000);
    expect(feeForYear(fees, 2019)).toBe(3000);
    expect(feeForYear(fees, 2020)).toBe(5000);
    expect(feeForYear(fees, 2030)).toBe(8000);
  });

  it('is null before the first fee', () => {
    expect(feeForYear(fees, 2010)).toBeNull();
    expect(feeForYear([], 2020)).toBeNull();
  });
});

describe('paymentFee', () => {
  const method = (over: Partial<PaymentMethodSettings>): PaymentMethodSettings => ({
    enabled: true,
    feePercent: 0,
    feeFixed: 0,
    feeMin: 0,
    ...over,
  });

  it('is nothing when there is nothing to pay', () => {
    expect(paymentFee(0, method({ feePercent: 2, feeMin: 100 }))).toBe(0);
    expect(paymentFee(-500, method({ feePercent: 2 }))).toBe(0);
  });

  it('is sized so the club gets the whole amount after the provider takes its cut', () => {
    // 10 000 + fee, minus 2% of that, is the 10 000 again
    const fee = paymentFee(10000, method({ feePercent: 2 }));
    expect(fee).toBe(204);
    expect(Math.round((10000 + fee) * 0.98)).toBe(10000);
  });

  it('adds the fixed part before the percentage', () => {
    expect(paymentFee(10000, method({ feePercent: 1.5, feeFixed: 85 }))).toBe(239);
  });

  it('is never less than the minimum', () => {
    expect(paymentFee(1000, method({ feePercent: 1, feeMin: 50 }))).toBe(50);
  });
});

describe('DartsService', () => {
  const service = () => TestBed.inject(DartsService);
  const games = `${API}/jatekok/darts/games`;

  itSendsRequests([
    ['finish', () => service().finish('g1'), 'POST', `${games}/g1/finish`, {}],
    ['abandon', () => service().abandon('g1'), 'POST', `${games}/g1/abandon`, {}],
    ['undo', () => service().undo('g1'), 'DELETE', `${games}/g1/throws/last`],
    [
      'throwDart',
      () => service().throwDart('g1', { segment: 20, multiplier: 3 }),
      'POST',
      `${games}/g1/throws`,
      { segment: 20, multiplier: 3 },
    ],
    [
      'editTurn',
      () => service().editTurn('g1', 2, [{ segment: 5, multiplier: 1 }]),
      'PATCH',
      `${games}/g1/turns/2`,
      { throws: [{ segment: 5, multiplier: 1 }] },
    ],
    [
      'editTurn as a preview',
      () => service().editTurn('g1', 2, [], true),
      'PATCH',
      `${games}/g1/turns/2?preview=true`,
    ],
    [
      'getLeaderboard of a start score',
      () => service().getLeaderboard('x01', 501),
      'GET',
      `${API}/jatekok/darts/leaderboard?type=x01&startScore=501`,
    ],
    [
      'getLeaderboard of Cricket',
      () => service().getLeaderboard('cricket'),
      'GET',
      `${API}/jatekok/darts/leaderboard?type=cricket`,
    ],
  ]);

  it('unwraps the lists and the game from the response', () => {
    const got: unknown[] = [];
    service()
      .getPeople()
      .subscribe((v) => got.push(v));
    http.expectOne(`${API}/jatekok/players`).flush({ data: { players: [{ _id: 'u1' }] } });
    service()
      .getGames()
      .subscribe((v) => got.push(v));
    http.expectOne(games).flush({ data: { games: [{ _id: 'g1' }] } });
    service()
      .getGame('g1')
      .subscribe((v) => got.push(v));
    http.expectOne(`${games}/g1`).flush({ data: { game: { _id: 'g1' } } });
    service()
      .createGame({ type: 'cricket', players: [{ guestName: 'Vendég' }] })
      .subscribe((v) => got.push(v));
    http.expectOne(games).flush({ data: { game: { _id: 'g2' } } });

    expect(got).toEqual([[{ _id: 'u1' }], [{ _id: 'g1' }], { _id: 'g1' }, { _id: 'g2' }]);
  });
});

describe('dartLabel', () => {
  it.each([
    [0, 1, '–'],
    [25, 1, '25'],
    [25, 2, 'Bull'],
    [20, 1, '20'],
    [16, 2, 'D16'],
    [20, 3, 'T20'],
  ])('segment %i × %i is "%s"', (segment, multiplier, label) => {
    expect(dartLabel({ segment, multiplier })).toBe(label);
  });
});

describe('gameName', () => {
  it('names an X01 game by its start score and Cricket by its name', () => {
    expect(gameName({ type: 'x01', options: { startScore: 301, outMode: 'double' } })).toBe('301');
    expect(gameName({ type: 'cricket', options: { startScore: 0, outMode: 'single' } })).toBe(
      'Cricket',
    );
  });
});
