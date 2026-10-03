import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API } from '../../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../../testing/component';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { BirthdayService } from '../../../shared/birthday/birthday.service';
import { BarionWithdraw } from './barion-withdraw/barion-withdraw';
import { KlubSettings } from './settings';

const MB = 1024 * 1024;
const method = { enabled: true, feePercent: 2, feeFixed: 0, feeMin: 0 };

/** What the server answers when the page opens. */
const loaded = () => ({
  'GET /settings/membership-fees': {
    data: {
      fees: [
        { fromYear: 2019, amount: 3000 },
        { fromYear: 2024, amount: 5000 },
      ],
      foundingYear: 2019,
      paidYears: [2020],
      history: [{ at: '2026-01-01', byName: 'Gazda', change: 'Tagdíj 2024-től 5000 Ft' }],
    },
  },
  'GET /settings/membership-reminder': {
    data: {
      reminder: {
        enabled: true,
        startMonth: 3,
        startDay: 1,
        frequency: 'quarterly',
        lastRoundSent: null,
        dates: ['2026-03-01'],
        nextRound: '2026-06-01',
      },
      year: 2026,
      recipients: ['Tag Tamás'],
    },
  },
  'GET /settings/payment-methods': { data: { stripe: method, barion: { ...method, feeMin: 100 } } },
  'GET /settings/chat-images': {
    data: { quotaMB: 100, dailyLimit: 10, usage: { bytes: 25 * MB, count: 4 } },
  },
  'GET /settings/image-cache': { data: { quotaMB: 1000, usage: { bytes: 2000 * MB, count: 9 } } },
  'GET /settings/birthday': {
    data: { enabled: true, effect: 'confetti', message: 'Boldog, {név}!' },
  },
  'GET /settings/rank': { data: { enabled: false, effect: 'stars', message: '{név}: {rang}' } },
  'GET /settings/president': { data: { presidentName: 'Elnök Elek' } },
  'GET /health/version': { data: { version: '1.2.3', commit: 'abc', date: null, builtAt: null } },
  'GET /settings/barion': {
    data: {
      membership: { payeeEmail: 'tag@klub.hu', withdrawName: 'Klub', withdrawIban: 'HU11' },
      tour: { payeeEmail: '', withdrawName: '', withdrawIban: '' },
    },
  },
  'GET /payments/withdraw/membershipFee': { data: { configured: true } },
  'GET /payments/withdraw/tourAdvance': { data: { configured: false } },
});

describe('KlubSettings', () => {
  let fixture: ComponentFixture<KlubSettings>;
  let page: KlubSettings;
  let http: HttpTestingController;
  let success: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  function open(routes: Record<string, object> = loaded()) {
    fixture = TestBed.createComponent(KlubSettings);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond(routes);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [KlubSettings], providers: [pageTesting()] });
    http = TestBed.inject(HttpTestingController);
    const notifications = TestBed.inject(NotificationsService);
    success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
    error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('loads every card', () => {
    open();
    expect(page.loading()).toBe(false);
    expect(page.rows()).toHaveLength(2);
    expect(page.currentFee()).toBe(5000);
    expect(page.reminder()?.enabled).toBe(true);
    expect(page.reminderRecipients()).toEqual(['Tag Tamás']);
    expect(page.payForm()?.barion.feeMin).toBe(100);
    expect(page.chatImages()?.quotaMB).toBe(100);
    expect(page.imageCache()?.quotaMB).toBe(1000);
    expect(page.bdMessage()).toBe('Boldog, {név}!');
    expect(page.rkEffect()).toBe('stars');
    expect(page.presidentName()).toBe('Elnök Elek');
    expect(page.sealUrl()).toBe(`${API}/settings/president/seal.png?v=Eln%C3%B6k%20Elek`);
    expect(page.serverBuild()?.version).toBe('1.2.3');
    expect(fixture.nativeElement.textContent).toContain('Tag Tamás');
  });

  it('still opens when the requests fail', () => {
    const routes = Object.fromEntries(Object.keys(loaded()).map((key) => [key, fail(500)]));
    open({ ...routes, 'GET /settings/membership-fees': fail(403, 'Nincs jogod.') });
    expect(page.loading()).toBe(false);
    expect(page.reminderLoading()).toBe(false);
    expect(error).toHaveBeenCalledWith('Nincs jogod.');
    expect(page.chatUsagePercent()).toBe(0);
    expect(page.imageCachePercent()).toBe(0);
    expect(page.payExample('stripe', 1000)).toBe('1000'); // no method known: no fee
  });

  describe('membership fees', () => {
    beforeEach(() => open());

    it('labels each fee with the years it covers', () => {
      const [first, second] = page.rows();
      expect(page.rangeLabel(first)).toBe('2019–2023');
      expect(page.rangeLabel(second)).toBe('2024-től');
      page.update(second, 'fromYear', 2020);
      expect(page.rangeLabel(page.rows()[0])).toBe('2019');
    });

    it('locks a fee that was already paid for, and marks the founding one', () => {
      const [first, second] = page.rows();
      expect(page.isLocked(first)).toBe(true); // 2020 was paid
      expect(page.isLocked(second)).toBe(false);
      expect(page.isLocked({ fromYear: 2030, amount: 1 })).toBe(false);
      expect(page.isFounding(first)).toBe(true);
      expect(page.isFounding(second)).toBe(false);
    });

    it('adds a row for a future year, and can drop or undo it', () => {
      expect(page.dirty()).toBe(false);
      page.addRow();
      const added = page.rows().at(-1)!;
      expect(added.fromYear).toBe(page.currentYear + 1);
      expect(added.amount).toBe(5000);
      expect(page.dirty()).toBe(true);

      page.removeRow(added);
      expect(page.dirty()).toBe(false);
      page.addRow();
      page.reset();
      expect(page.rows()).toHaveLength(2);
    });

    it('saves the rows sorted by year and reloads the history', () => {
      page.addRow();
      page.update(page.rows().at(-1)!, 'amount', 7000);
      page.save();
      page.save(); // a second click while saving does nothing
      const req = http.expectOne(`${API}/settings/membership-fees`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body.fees.map((f: { amount: number }) => f.amount)).toEqual([
        3000, 5000, 7000,
      ]);
      req.flush({ data: { fees: req.request.body.fees } });
      expect(success).toHaveBeenCalledWith('Tagdíj mentve.');
      expect(page.dirty()).toBe(false);

      respond({
        'GET /settings/membership-fees': {
          data: { fees: [], foundingYear: 2019, history: [], paidYears: [2020, 2021] },
        },
      });
      expect(page.paidYears()).toEqual([2020, 2021]);
      expect(page.history()).toEqual([]);
    });

    it("shows the server's reason when the save is refused", () => {
      page.save();
      respond({ 'PUT /settings/membership-fees': fail(400, 'Befizetett évet nem írhatsz át.') });
      expect(error).toHaveBeenCalledWith('Befizetett évet nem írhatsz át.');
      expect(page.saving()).toBe(false);
    });
  });

  describe('membership reminder', () => {
    beforeEach(() => open());

    it('previews the rounds of the year from the chosen start and frequency', () => {
      expect(page.previewDates()).toEqual([
        'március 1.',
        'június 1.',
        'szeptember 1.',
        'december 1.',
      ]);
      page.reminderFrequency.set('monthly');
      page.reminderMonth.set(11);
      page.reminderDay.set(15);
      expect(page.previewDates()).toEqual(['november 15.', 'december 15.']);
      expect(page.roundLabel('2026-06-01')).toBe('június 1.');
    });

    it('is dirty after a change and clean again after a reset', () => {
      expect(page.reminderDirty()).toBe(false);
      page.reminderEnabled.set(false);
      expect(page.reminderDirty()).toBe(true);
      page.resetReminder();
      expect(page.reminderDirty()).toBe(false);
    });

    it('saves the form', () => {
      page.reminderDay.set(5);
      page.saveReminder();
      page.saveReminder();
      const req = http.expectOne(`${API}/settings/membership-reminder`);
      expect(req.request.body).toEqual({
        enabled: true,
        startMonth: 3,
        startDay: 5,
        frequency: 'quarterly',
      });
      req.flush({ data: { reminder: { ...page.reminder()!, startDay: 5 } } });
      expect(success).toHaveBeenCalledWith('Tagdíj emlékeztető mentve.');
      expect(page.reminderDirty()).toBe(false);
    });

    it('reports a failed save and a failed test e-mail', () => {
      page.saveReminder();
      respond({ 'PUT /settings/membership-reminder': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
      page.sendTestReminder();
      respond({ 'POST /settings/membership-reminder/test': fail(500, 'Nincs SMTP.') });
      expect(error).toHaveBeenCalledWith('Nincs SMTP.');
      expect(page.sendingTest()).toBe(false);
    });

    it('sends a test e-mail to the admin', () => {
      page.sendTestReminder();
      page.sendTestReminder();
      respond({ 'POST /settings/membership-reminder/test': { data: { sentTo: 'a@b.hu' } } });
      expect(success).toHaveBeenCalledWith('Próba e-mail elküldve: a@b.hu');
    });
  });

  describe('chat photos and the image cache', () => {
    beforeEach(() => open());

    it('shows how full they are, capped at 100%', () => {
      expect(page.chatUsagePercent()).toBe(25);
      expect(page.chatUsageMB()).toBe(25);
      expect(page.imageCachePercent()).toBe(100);
      expect(page.imageCacheUsageMB()).toBe(2000);
    });

    it('saves the chat photo limits and says how many photos had to go', () => {
      page.chatQuotaMB.set(10);
      expect(page.chatImagesDirty()).toBe(true);
      page.saveChatImages();
      page.saveChatImages();
      const usage = { bytes: 9 * MB, count: 2 };
      respond({
        'PUT /settings/chat-images': { data: { quotaMB: 10, dailyLimit: 10, usage, removed: 2 } },
      });
      expect(success).toHaveBeenCalledWith(
        'Kotyogó fotók mentve – 2 régi fotó törölve, hogy beférjen.',
      );
      expect(page.chatImagesDirty()).toBe(false);

      page.saveChatImages();
      respond({
        'PUT /settings/chat-images': { data: { quotaMB: 10, dailyLimit: 10, usage, removed: 0 } },
      });
      expect(success).toHaveBeenLastCalledWith('Kotyogó fotók mentve.');

      page.saveChatImages();
      respond({ 'PUT /settings/chat-images': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('saves the cache size', () => {
      page.imageCacheQuotaMB.set(3000);
      expect(page.imageCacheDirty()).toBe(true);
      page.saveImageCache();
      page.saveImageCache();
      const usage = { bytes: 0, count: 0 };
      respond({ 'PUT /settings/image-cache': { data: { quotaMB: 3000, usage, removed: 5 } } });
      expect(success.mock.calls.at(-1)![0]).toContain('5 régóta nem nézett kép törölve');

      page.saveImageCache();
      respond({ 'PUT /settings/image-cache': { data: { quotaMB: 3000, usage, removed: 0 } } });
      expect(success).toHaveBeenLastCalledWith('Kép gyorsítótár mentve.');

      page.saveImageCache();
      respond({ 'PUT /settings/image-cache': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('empties the cache only after a yes', async () => {
      const confirm = TestBed.inject(ConfirmService);
      void page.clearImageCache();
      confirm.answer(false);
      await settle();
      http.expectNone(`${API}/settings/image-cache`);

      void page.clearImageCache();
      confirm.answer(true);
      await settle();
      respond({
        'DELETE /settings/image-cache': {
          data: { quotaMB: 1000, usage: { bytes: 0, count: 0 }, removed: 9 },
        },
      });
      expect(success).toHaveBeenCalledWith('Kép gyorsítótár kiürítve – 9 kép törölve.');
      expect(page.imageCachePercent()).toBe(0);

      void page.clearImageCache();
      confirm.answer(true);
      await settle();
      respond({ 'DELETE /settings/image-cache': fail() });
      expect(error).toHaveBeenCalledWith('Az ürítés nem sikerült.');
    });
  });

  describe('payment methods', () => {
    beforeEach(() => open());

    it('edits one method without touching the other', () => {
      page.setPayField('stripe', 'feePercent', '3.5');
      page.setPayField('stripe', 'enabled', 0);
      expect(page.payForm()?.stripe).toMatchObject({ feePercent: 3.5, enabled: false });
      expect(page.payMethodDirty('stripe')).toBe(true);
      expect(page.payMethodDirty('barion')).toBe(false);
      page.resetPayMethod('stripe');
      expect(page.payMethodDirty('stripe')).toBe(false);
    });

    it('shows what a payer would pay with the fee on top', () => {
      const digits = (text: string) => text.replace(/\D/g, '');
      expect(digits(page.payExample('stripe', 10000))).toBe('10204');
      expect(digits(page.payExample('barion', 1000))).toBe('1100'); // the minimum fee
    });

    it('saves a method', () => {
      page.setPayField('barion', 'feeFixed', 50);
      page.savePayMethod('barion');
      page.savePayMethod('stripe'); // one save at a time
      const req = http.expectOne(`${API}/settings/payment-methods/barion`);
      req.flush({ data: req.request.body });
      expect(success).toHaveBeenCalledWith('Barion beállítás mentve.');
      expect(page.payMethodDirty('barion')).toBe(false);
      respond({ 'GET /settings/membership-fees': { data: { fees: [], foundingYear: 2019 } } });
      expect(page.history()).toEqual([]);

      page.savePayMethod('stripe');
      respond({ 'PUT /settings/payment-methods/stripe': fail(400, 'Túl nagy díj.') });
      expect(error).toHaveBeenCalledWith('Túl nagy díj.');
      expect(page.savingPayMethod()).toBeNull();
    });
  });

  describe('birthday and rank celebrations', () => {
    let play: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      play = vi.spyOn(TestBed.inject(BirthdayService), 'play').mockResolvedValue();
      logIn({ role: 'admin', name: 'Teszt Elek' });
      open();
    });

    it('previews the greeting with my given name', () => {
      page.previewBirthday();
      expect(play).toHaveBeenCalledWith('confetti', 'Boldog, Elek!');
      page.bdMessage.set('  ');
      page.previewBirthday();
      expect(play).toHaveBeenLastCalledWith('confetti', 'Boldog születésnapot, Elek! 🎂');
    });

    it('previews the rank greeting with sample values', () => {
      page.previewRank();
      expect(play).toHaveBeenCalledWith('stars', 'Elek: Bronz', 'rank');
      page.rkMessage.set('');
      page.previewRank();
      expect(play).toHaveBeenLastCalledWith('stars', 'Kedves Elek! Túléltél 10 bódorgót!', 'rank');
    });

    it('saves the birthday card', () => {
      page.bdMessage.set(' Isten éltessen! ');
      expect(page.birthdayDirty()).toBe(true);
      page.resetBirthday();
      expect(page.birthdayDirty()).toBe(false);

      page.bdEffect.set('snow');
      page.saveBirthday();
      page.saveBirthday();
      const req = http.expectOne(`${API}/settings/birthday`);
      expect(req.request.body).toEqual({
        enabled: true,
        effect: 'snow',
        message: 'Boldog, {név}!',
      });
      req.flush({ data: req.request.body });
      expect(success).toHaveBeenCalledWith('Születésnap beállítás mentve.');

      page.saveBirthday();
      respond({ 'PUT /settings/birthday': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('saves the rank card', () => {
      page.rkEnabled.set(true);
      expect(page.rankDirty()).toBe(true);
      page.resetRank();
      expect(page.rankDirty()).toBe(false);

      page.rkEnabled.set(true);
      page.saveRank();
      page.saveRank();
      const req = http.expectOne(`${API}/settings/rank`);
      req.flush({ data: req.request.body });
      expect(success).toHaveBeenCalledWith('Rangok ünneplése mentve.');

      page.saveRank();
      respond({ 'PUT /settings/rank': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });
  });

  it('saves the president, which also refreshes the seal', () => {
    open();
    page.presidentName.set(' Új Elnök ');
    expect(page.presidentDirty()).toBe(true);
    page.savePresident();
    page.savePresident();
    const req = http.expectOne(`${API}/settings/president`);
    expect(req.request.body).toEqual({ presidentName: 'Új Elnök' });
    req.flush({ data: { presidentName: 'Új Elnök' } });
    expect(success).toHaveBeenCalledWith('Elnök mentve.');
    expect(page.sealUrl()).toContain('%C3%9Aj%20Eln%C3%B6k');

    page.savePresident();
    respond({ 'PUT /settings/president': fail() });
    expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
  });
});

describe('BarionWithdraw', () => {
  let fixture: ComponentFixture<BarionWithdraw>;
  let card: BarionWithdraw;
  let http: HttpTestingController;

  function open(wallet: 'membership' | 'tour', routes: Record<string, object> = loaded()) {
    fixture = TestBed.createComponent(BarionWithdraw);
    fixture.componentRef.setInput('wallet', wallet);
    card = fixture.componentInstance;
    fixture.detectChanges();
    respond(routes);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BarionWithdraw], providers: [pageTesting()] });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the wallet of the membership fees', () => {
    open('membership');
    expect(card.title()).toBe('Tagdíjak');
    expect(card.account()?.payeeEmail).toBe('tag@klub.hu');
    expect(card.configured()).toBe(true);
  });

  it('shows the wallet of the tour advances', () => {
    open('tour');
    expect(card.title()).toBe('Előlegek');
    expect(card.configured()).toBe(false);
  });

  it('opens even when nothing could be loaded', () => {
    open('tour', {
      'GET /settings/barion': fail(),
      'GET /payments/withdraw/tourAdvance': fail(),
    });
    expect(card.account()).toBeNull();
    card.startEdit();
    expect(card.form).toEqual({ payeeEmail: '', withdrawName: '', withdrawIban: '' });
  });

  it('edits the account and re-checks whether it can pay out', () => {
    open('membership');
    card.startEdit();
    expect(card.form.withdrawIban).toBe('HU11');
    card.form.withdrawIban = 'HU22';
    card.save();
    card.save();
    const req = http.expectOne(`${API}/settings/barion/membership`);
    expect(req.request.body.withdrawIban).toBe('HU22');
    req.flush({ data: req.request.body });
    expect(card.editing()).toBe(false);
    expect(card.account()?.withdrawIban).toBe('HU22');
    respond({ 'GET /payments/withdraw/membershipFee': { data: { configured: false } } });
    expect(card.configured()).toBe(false);
  });

  it('keeps the form open with the reason when the save fails', () => {
    open('membership');
    card.startEdit();
    card.save();
    respond({ 'PUT /settings/barion/membership': fail(400, 'Hibás IBAN.') });
    expect(card.formError()).toBe('Hibás IBAN.');
    expect(card.editing()).toBe(true);
  });

  it('shows the fee: 0.1%, but at least 70 Ft', () => {
    open('membership');
    expect(card.fee()).toBe(0);
    card.amount.set(10000);
    expect(card.fee()).toBe(70);
    expect(card.net()).toBe(9930);
    card.amount.set(200000);
    expect(card.fee()).toBe(200);
  });

  it('withdraws and reports what arrived', () => {
    open('membership');
    card.withdraw(); // no amount yet
    http.expectNone(`${API}/payments/withdraw`);

    card.amount.set(10000);
    card.withdraw();
    card.withdraw();
    const req = http.expectOne(`${API}/payments/withdraw`);
    expect(req.request.body).toEqual({ purpose: 'membershipFee', amount: 10000 });
    req.flush({ data: { fee: 70, net: 9930 } });
    expect(card.notice()?.kind).toBe('success');
    // hu-HU groups thousands only from five digits up
    expect(card.notice()?.text).toBe('Sikeres kiutalás: 9930 Ft nettó (70 Ft díj levonva).');
    expect(card.amount()).toBeNull();
  });

  it('reports a failed withdrawal', () => {
    open('membership');
    card.amount.set(500);
    card.withdraw();
    respond({ 'POST /payments/withdraw': fail(400, 'Nincs elég egyenleg.') });
    expect(card.notice()).toEqual({ kind: 'error', text: 'Nincs elég egyenleg.' });
    expect(card.withdrawing()).toBe(false);
  });
});
