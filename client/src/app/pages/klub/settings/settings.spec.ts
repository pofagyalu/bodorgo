import { Type } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { API } from '../../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../../testing/component';
import { makeWeatherRules } from '../../../../testing/fixtures';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { AuthService } from '../../../auth/auth.service';
import { BirthdayService } from '../../../shared/birthday/birthday.service';
import { BarionWithdraw } from './barion-withdraw/barion-withdraw';
import { BankAccount } from './bank-account/bank-account';
import { KlubSettings, TAB_KEYS } from './settings';
import { OidcSettingsTab } from './oidc-settings/oidc-settings';
import { ClubSettingsTab } from './club-settings/club-settings';
import { PaymentSettingsTab } from './payment-settings/payment-settings';
import { StorageSettingsTab } from './storage-settings/storage-settings';
import { AppSettingsTab } from './app-settings/app-settings';
import { InfoSettingsTab } from './info-settings/info-settings';

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
  'GET /settings/yearly-report': {
    data: {
      year: 2026,
      sendsOn: '2027-01-01',
      recipients: ['Admin Anna', 'Tag Tamás'],
      lastSentYear: null,
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
  'GET /settings/weather-outlook': { data: makeWeatherRules() },
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

  // Each tab is a component of its own inside the page.
  const tab = <T>(type: Type<T>) =>
    fixture.debugElement.query(By.directive(type)).componentInstance as T;
  const club = () => tab(ClubSettingsTab);
  const pay = () => tab(PaymentSettingsTab);
  const storage = () => tab(StorageSettingsTab);
  const app = () => tab(AppSettingsTab);
  const info = () => tab(InfoSettingsTab);

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
    expect(club().loading()).toBe(false);
    expect(club().rows()).toHaveLength(2);
    expect(club().currentFee()).toBe(5000);
    expect(club().reminder()?.enabled).toBe(true);
    expect(club().reminderRecipients()).toEqual(['Tag Tamás']);
    expect(pay().payForm()?.barion.feeMin).toBe(100);
    expect(storage().chatImages()?.quotaMB).toBe(100);
    expect(storage().imageCache()?.quotaMB).toBe(1000);
    expect(app().bdMessage()).toBe('Boldog, {név}!');
    expect(app().rkEffect()).toBe('stars');
    expect(club().presidentName()).toBe('Elnök Elek');
    expect(club().sealUrl()).toBe(`${API}/settings/president/seal.png?v=Eln%C3%B6k%20Elek`);
    expect(info().serverBuild()?.version).toBe('1.2.3');
    expect(fixture.nativeElement.textContent).toContain('Tag Tamás');
  });

  it('shows one page of cards at a time, and writes the open one into the address', () => {
    open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const hidden = () =>
      [...fixture.nativeElement.querySelectorAll('[role="tabpanel"]')].map(
        (panel: HTMLElement) => panel.hidden,
      );
    expect(page.activeTab()).toBe('club');
    expect(hidden()).toEqual([false, true, true, true, true, true]);

    fixture.nativeElement.querySelectorAll('[role="tab"]')[5].click();
    fixture.detectChanges();
    expect(page.activeTab()).toBe('info');
    expect(hidden()).toEqual([true, true, true, true, true, false]);
    expect(navigate.mock.calls[0][1]).toMatchObject({ queryParams: { lap: TAB_KEYS.info } });
  });

  it('still opens when the requests fail', () => {
    const routes = Object.fromEntries(Object.keys(loaded()).map((key) => [key, fail(500)]));
    open({ ...routes, 'GET /settings/membership-fees': fail(403, 'Nincs jogod.') });
    expect(club().loading()).toBe(false);
    expect(club().reminderLoading()).toBe(false);
    expect(error).toHaveBeenCalledWith('Nincs jogod.');
    expect(storage().chatUsagePercent()).toBe(0);
    expect(storage().imageCachePercent()).toBe(0);
    expect(pay().payExample('stripe', 1000)).toBe('1000'); // no method known: no fee
  });

  describe('membership fees', () => {
    beforeEach(() => open());

    it('labels each fee with the years it covers', () => {
      const [first, second] = club().rows();
      expect(club().rangeLabel(first)).toBe('2019–2023');
      expect(club().rangeLabel(second)).toBe('2024-től');
      club().update(second, 'fromYear', 2020);
      expect(club().rangeLabel(club().rows()[0])).toBe('2019');
    });

    it('locks a fee that was already paid for, and marks the founding one', () => {
      const [first, second] = club().rows();
      expect(club().isLocked(first)).toBe(true); // 2020 was paid
      expect(club().isLocked(second)).toBe(false);
      expect(club().isLocked({ fromYear: 2030, amount: 1 })).toBe(false);
      expect(club().isFounding(first)).toBe(true);
      expect(club().isFounding(second)).toBe(false);
    });

    it('adds a row for a future year, and can drop or undo it', () => {
      expect(club().dirty()).toBe(false);
      club().addRow();
      const added = club().rows().at(-1)!;
      expect(added.fromYear).toBe(club().currentYear + 1);
      expect(added.amount).toBe(5000);
      expect(club().dirty()).toBe(true);

      club().removeRow(added);
      expect(club().dirty()).toBe(false);
      club().addRow();
      club().reset();
      expect(club().rows()).toHaveLength(2);
    });

    it('saves the rows sorted by year and reloads the paid years', () => {
      club().addRow();
      club().update(club().rows().at(-1)!, 'amount', 7000);
      club().save();
      club().save(); // a second click while saving does nothing
      const req = http.expectOne(`${API}/settings/membership-fees`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body.fees.map((f: { amount: number }) => f.amount)).toEqual([
        3000, 5000, 7000,
      ]);
      req.flush({ data: { fees: req.request.body.fees } });
      expect(success).toHaveBeenCalledWith('Tagdíj mentve.');
      expect(club().dirty()).toBe(false);

      respond({
        'GET /settings/membership-fees': {
          data: { fees: [], foundingYear: 2019, paidYears: [2020, 2021] },
        },
      });
      expect(club().paidYears()).toEqual([2020, 2021]);
    });

    it("shows the server's reason when the save is refused", () => {
      club().save();
      respond({ 'PUT /settings/membership-fees': fail(400, 'Befizetett évet nem írhatsz át.') });
      expect(error).toHaveBeenCalledWith('Befizetett évet nem írhatsz át.');
      expect(club().saving()).toBe(false);
    });
  });

  describe('membership reminder', () => {
    beforeEach(() => open());

    it('previews the rounds of the year from the chosen start and frequency', () => {
      expect(club().previewDates()).toEqual([
        'március 1.',
        'június 1.',
        'szeptember 1.',
        'december 1.',
      ]);
      club().reminderFrequency.set('monthly');
      club().reminderMonth.set(11);
      club().reminderDay.set(15);
      expect(club().previewDates()).toEqual(['november 15.', 'december 15.']);
      expect(club().roundLabel('2026-06-01')).toBe('június 1.');
    });

    it('is dirty after a change and clean again after a reset', () => {
      expect(club().reminderDirty()).toBe(false);
      club().reminderEnabled.set(false);
      expect(club().reminderDirty()).toBe(true);
      club().resetReminder();
      expect(club().reminderDirty()).toBe(false);
    });

    it('saves the form', () => {
      club().reminderDay.set(5);
      club().saveReminder();
      club().saveReminder();
      const req = http.expectOne(`${API}/settings/membership-reminder`);
      expect(req.request.body).toEqual({
        enabled: true,
        startMonth: 3,
        startDay: 5,
        frequency: 'quarterly',
      });
      req.flush({ data: { reminder: { ...club().reminder()!, startDay: 5 } } });
      expect(success).toHaveBeenCalledWith('Tagdíj emlékeztető mentve.');
      expect(club().reminderDirty()).toBe(false);
    });

    it('reports a failed save and a failed test e-mail', () => {
      club().saveReminder();
      respond({ 'PUT /settings/membership-reminder': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
      club().sendTestReminder();
      respond({ 'POST /settings/membership-reminder/test': fail(500, 'Nincs SMTP.') });
      expect(error).toHaveBeenCalledWith('Nincs SMTP.');
      expect(club().sendingTest()).toBe(false);
    });

    it('says every unpaid club member gets one, and "mindenki befizette" only when true', () => {
      const text = () => fixture.nativeElement.textContent as string;
      expect(text()).not.toContain('mindenki befizette');
      expect(text()).toContain('akkor is, ha még nem lépett be');

      club().reminderRecipients.set([]);
      fixture.detectChanges();
      expect(text()).toContain('Senki – mindenki befizette az idei tagdíjat.');
    });

    it('sends a test e-mail to the admin', () => {
      club().sendTestReminder();
      club().sendTestReminder();
      respond({ 'POST /settings/membership-reminder/test': { data: { sentTo: 'a@b.hu' } } });
      expect(success).toHaveBeenCalledWith('Próba e-mail elküldve: a@b.hu');
    });
  });

  describe('yearly report', () => {
    beforeEach(() => open());

    it('shows when it goes, to whom, and where the PDF is', () => {
      expect(app().yearlyReport()?.year).toBe(2026);
      expect(app().yearlyReportPdfUrl).toBe(`${API}/settings/yearly-report/preview.pdf`);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('2027. január 1.');
      expect(text).toContain('Most 2 klubtag kapná meg');
    });

    it('sends a test e-mail to the admin, once per press', () => {
      app().sendTestYearlyReport();
      app().sendTestYearlyReport();
      respond({ 'POST /settings/yearly-report/test': { data: { sentTo: 'a@b.hu', year: 2026 } } });
      expect(success).toHaveBeenCalledWith('Próba e-mail elküldve: a@b.hu');
      expect(app().sendingYearlyTest()).toBe(false);
    });

    it('says so when the test e-mail fails', () => {
      app().sendTestYearlyReport();
      respond({ 'POST /settings/yearly-report/test': fail(500, 'Nincs SMTP.') });
      expect(error).toHaveBeenCalledWith('Nincs SMTP.');
      expect(app().sendingYearlyTest()).toBe(false);
    });
  });

  describe('chat photos and the image cache', () => {
    beforeEach(() => open());

    it('shows how full they are, capped at 100%', () => {
      expect(storage().chatUsagePercent()).toBe(25);
      expect(storage().chatUsageMB()).toBe(25);
      expect(storage().imageCachePercent()).toBe(100);
      expect(storage().imageCacheUsageMB()).toBe(2000);
    });

    it('saves the chat photo limits and says how many photos had to go', () => {
      storage().chatQuotaMB.set(10);
      expect(storage().chatImagesDirty()).toBe(true);
      storage().saveChatImages();
      storage().saveChatImages();
      const usage = { bytes: 9 * MB, count: 2 };
      respond({
        'PUT /settings/chat-images': { data: { quotaMB: 10, dailyLimit: 10, usage, removed: 2 } },
      });
      expect(success).toHaveBeenCalledWith(
        'Kotyogó fotók mentve – 2 régi fotó törölve, hogy beférjen.',
      );
      expect(storage().chatImagesDirty()).toBe(false);

      storage().saveChatImages();
      respond({
        'PUT /settings/chat-images': { data: { quotaMB: 10, dailyLimit: 10, usage, removed: 0 } },
      });
      expect(success).toHaveBeenLastCalledWith('Kotyogó fotók mentve.');

      storage().saveChatImages();
      respond({ 'PUT /settings/chat-images': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('saves the cache size', () => {
      storage().imageCacheQuotaMB.set(3000);
      expect(storage().imageCacheDirty()).toBe(true);
      storage().saveImageCache();
      storage().saveImageCache();
      const usage = { bytes: 0, count: 0 };
      respond({ 'PUT /settings/image-cache': { data: { quotaMB: 3000, usage, removed: 5 } } });
      expect(success.mock.calls.at(-1)![0]).toContain('5 régóta nem nézett kép törölve');

      storage().saveImageCache();
      respond({ 'PUT /settings/image-cache': { data: { quotaMB: 3000, usage, removed: 0 } } });
      expect(success).toHaveBeenLastCalledWith('Kép gyorsítótár mentve.');

      storage().saveImageCache();
      respond({ 'PUT /settings/image-cache': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('empties the cache only after a yes', async () => {
      const confirm = TestBed.inject(ConfirmService);
      void storage().clearImageCache();
      confirm.answer(false);
      await settle();
      http.expectNone(`${API}/settings/image-cache`);

      void storage().clearImageCache();
      confirm.answer(true);
      await settle();
      respond({
        'DELETE /settings/image-cache': {
          data: { quotaMB: 1000, usage: { bytes: 0, count: 0 }, removed: 9 },
        },
      });
      expect(success).toHaveBeenCalledWith('Kép gyorsítótár kiürítve – 9 kép törölve.');
      expect(storage().imageCachePercent()).toBe(0);

      void storage().clearImageCache();
      confirm.answer(true);
      await settle();
      respond({ 'DELETE /settings/image-cache': fail() });
      expect(error).toHaveBeenCalledWith('Az ürítés nem sikerült.');
    });
  });

  describe('Átutalási díjak', () => {
    beforeEach(() => open());

    it('has no switch: both methods are on', () => {
      expect(pay().payForm()?.stripe.enabled).toBe(true);
      expect(pay().payForm()?.barion.enabled).toBe(true);
      expect(pay().payDirty()).toBe(false);
    });

    it('edits one method without touching the other, and undoes both at once', () => {
      pay().setPayField('stripe', 'feePercent', '3.5');
      expect(pay().payForm()?.stripe).toMatchObject({ feePercent: 3.5, enabled: true });
      expect(pay().payMethodDirty('stripe')).toBe(true);
      expect(pay().payMethodDirty('barion')).toBe(false);
      expect(pay().payDirty()).toBe(true);
      pay().resetPayMethods();
      expect(pay().payDirty()).toBe(false);
    });

    it('shows what a payer would pay with the fee on top', () => {
      const digits = (text: string) => text.replace(/\D/g, '');
      expect(digits(pay().payExample('stripe', 10000))).toBe('10204');
      expect(digits(pay().payExample('barion', 1000))).toBe('1100'); // the minimum fee
    });

    it('saves both with one Mentés - only the changed ones are sent', () => {
      pay().setPayField('barion', 'feeFixed', 50);
      pay().savePayMethods();
      pay().savePayMethods(); // one save at a time
      http.expectNone(`${API}/settings/payment-methods/stripe`);
      const req = http.expectOne(`${API}/settings/payment-methods/barion`);
      expect(req.request.body).toMatchObject({ feeFixed: 50, enabled: true });
      req.flush({ data: req.request.body });
      expect(success).toHaveBeenCalledWith('Átutalási díjak mentve.');
      expect(pay().payDirty()).toBe(false);

      pay().setPayField('stripe', 'feeMin', 10);
      pay().savePayMethods();
      respond({ 'PUT /settings/payment-methods/stripe': fail(400, 'Túl nagy díj.') });
      expect(error).toHaveBeenCalledWith('Túl nagy díj.');
      expect(pay().savingPay()).toBe(false);
    });
  });

  it('switches on a method that was saved as off with the next save', () => {
    open({
      ...loaded(),
      'GET /settings/payment-methods': {
        data: { stripe: method, barion: { ...method, enabled: false } },
      },
    });
    expect(pay().payMethodOff('barion')).toBe(true);
    expect(pay().payDirty()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('mentéskor bekapcsol');
    pay().savePayMethods();
    const req = http.expectOne(`${API}/settings/payment-methods/barion`);
    expect(req.request.body.enabled).toBe(true);
  });

  describe('OIDC szolgáltató - the role manager only', () => {
    // The tab is a component of its own inside the page (oidc-settings).
    const oidcTab = () =>
      fixture.debugElement.query(By.directive(OidcSettingsTab))
        .componentInstance as OidcSettingsTab;
    const oidc = {
      serverUrl: 'https://auth.test',
      providerSlug: 'bodorgo',
      clientId: 'client-1',
      hasClientSecret: true,
      postLogoutRedirectUri: 'https://klub.test',
      hasApiToken: true,
      invitationFlow: 'enrollment-invitation',
      source: 'database',
      unreadable: false,
      canSave: true,
      issuer: 'https://auth.test/application/o/bodorgo/',
      redirectUri: 'http://localhost:8235/auth/callback',
      redirectUris: [
        'http://localhost:8235/auth/callback',
        'https://api.bodorgo.hu/auth/callback',
        'https://bodorgo.hu',
      ],
      localLogin: false,
      active: 'authentik',
      providers: [] as object[],
    };
    const other = {
      id: 'p1',
      name: 'Másik',
      issuerUrl: 'https://id.test/realms/klub',
      clientId: 'klub-app',
      hasClientSecret: true,
      postLogoutRedirectUri: '',
      requireVerifiedEmail: true,
      unreadable: false,
    };
    const asOwner = (data: object = oidc) => {
      logIn({ role: 'admin', canManageRoles: true });
      open({ ...loaded(), 'GET /settings/oidc': { data } });
    };
    const tabLabels = () =>
      [...fixture.nativeElement.querySelectorAll('[role="tab"]')].map((tab: HTMLElement) =>
        tab.textContent?.trim(),
      );

    it('another admin has no such tab, and nothing is asked for', () => {
      logIn({ role: 'admin' });
      open();
      expect(tabLabels()).not.toContain('OIDC szolgáltató');
      expect(fixture.nativeElement.querySelector('.danger-zone')).toBeNull();
      http.expectNone(`${API}/settings/oidc`);
    });

    it('the role manager gets the tab, with the warning and no secret anywhere', () => {
      asOwner();
      expect(tabLabels()).toContain('OIDC szolgáltató');
      expect(fixture.nativeElement.querySelector('.danger-zone').textContent).toContain(
        'VESZÉLYES ZÓNA!!!',
      );
      expect(oidcTab().oidcServerUrl()).toBe('https://auth.test');
      expect(oidcTab().oidcClientSecret()).toBe('');
      expect(oidcTab().oidcApiToken()).toBe('');
      expect(oidcTab().oidcDirty()).toBe(false);
      // What to list among the provider's Redirect URIs: all three, as
      // information only - nothing to type into.
      const shown = [
        ...fixture.nativeElement.querySelectorAll('.oidc-authentik .oidc-uri code'),
      ].map((code: HTMLElement) => code.textContent);
      expect(shown).toEqual([
        'http://localhost:8235/auth/callback',
        'https://api.bodorgo.hu/auth/callback',
        'https://bodorgo.hu',
      ]);
      expect(
        fixture.nativeElement.querySelector('.oidc-info textarea, .oidc-info input'),
      ).toBeNull();
      expect(
        oidcTab()
          .redirectUris()
          .map((r) => r.note),
      ).toEqual([
        'belépés után ide érkezik – a saját gépeden futó szerver',
        'belépés után ide érkezik – az éles szerver',
        'kilépés után ide érkezik (Logout URI)',
      ]);
    });

    it('saves only after a yes; an empty secret is sent empty (the server keeps its own)', async () => {
      asOwner();
      const confirm = TestBed.inject(ConfirmService);
      oidcTab().oidcClientId.set(' client-2 ');
      expect(oidcTab().oidcDirty()).toBe(true);

      void oidcTab().saveOidc();
      confirm.answer(false);
      await settle();
      http.expectNone(`${API}/settings/oidc`);

      void oidcTab().saveOidc();
      confirm.answer(true);
      await settle();
      const req = http.expectOne(`${API}/settings/oidc`);
      expect(req.request.body).toEqual({
        serverUrl: 'https://auth.test',
        providerSlug: 'bodorgo',
        clientId: 'client-2',
        clientSecret: '',
        postLogoutRedirectUri: 'https://klub.test',
        apiToken: '',
        removeApiToken: false,
        invitationFlow: 'enrollment-invitation',
      });
      req.flush({ data: { ...oidc, clientId: 'client-2' } });
      respond({ 'GET /settings/membership-fees': loaded()['GET /settings/membership-fees'] });
      expect(success).toHaveBeenCalledWith('OIDC szolgáltató mentve.');
      expect(oidcTab().oidcDirty()).toBe(false);
    });

    it('a new secret is sent once and gone from the form afterwards; a refusal is shown', async () => {
      asOwner();
      const confirm = TestBed.inject(ConfirmService);
      oidcTab().oidcClientSecret.set('new-secret');
      oidcTab().oidcRemoveApiToken.set(true);
      void oidcTab().saveOidc();
      confirm.answer(true);
      await settle();
      const req = http.expectOne(`${API}/settings/oidc`);
      expect(req.request.body).toMatchObject({ clientSecret: 'new-secret', removeApiToken: true });
      req.flush({ data: { ...oidc, hasApiToken: false } });
      expect(oidcTab().oidcClientSecret()).toBe('');
      expect(oidcTab().oidcRemoveApiToken()).toBe(false);

      oidcTab().oidcServerUrl.set('https://typo.test');
      void oidcTab().saveOidc();
      confirm.answer(true);
      await settle();
      respond({ 'PUT /settings/oidc': fail(400, 'A szolgáltató nem válaszol.') });
      expect(error).toHaveBeenCalledWith('A szolgáltató nem válaszol.');
      expect(oidcTab().savingOidc()).toBe(false);

      oidcTab().resetOidc();
      expect(oidcTab().oidcServerUrl()).toBe('https://auth.test');
    });

    describe('changes only after identifying again', () => {
      const confirm = () => TestBed.inject(ConfirmService);
      const asking = 'Az OIDC szolgáltató módosítása: ehhez újra azonosítanod kell magad.';
      const longAgo = () => {
        logIn({ role: 'admin', canManageRoles: true, freshLoginSecondsLeft: 0 });
        open({ ...loaded(), 'GET /settings/oidc': { data: oidc } });
      };
      afterEach(() => sessionStorage.clear());

      it('asks as soon as a field is stepped into - and sends them to the provider', async () => {
        longAgo();
        const go = vi
          .spyOn(TestBed.inject(AuthService), 'identifyAgain')
          .mockImplementation(() => {});
        const field = fixture.nativeElement.querySelector(
          '.oidc-authentik input',
        ) as HTMLInputElement;
        const blur = vi.spyOn(field, 'blur');
        field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        respond({
          'GET /auth/me': { loggedIn: true, id: 'me', role: 'admin', canManageRoles: true },
        });
        await settle();
        expect(blur).toHaveBeenCalled();
        expect(confirm().pending()?.message).toBe(asking);
        confirm().answer(true);
        await settle();
        expect(go).toHaveBeenCalled();
      });

      it('saving, adding a provider: asked first, nothing sent on a no', async () => {
        longAgo();
        for (const action of [
          () => oidcTab().saveOidc(),
          () => {
            oidcTab().openProvider('new');
            return oidcTab().saveProvider();
          },
        ]) {
          void action();
          respond({
            'GET /auth/me': { loggedIn: true, id: 'me', role: 'admin', canManageRoles: true },
          });
          await settle();
          expect(confirm().pending()?.message).toBe(asking);
          confirm().answer(false);
          await settle();
        }
        http.expectNone(`${API}/settings/oidc`);
      });

      it('the minutes ran out meanwhile: asked again, not just refused', async () => {
        asOwner();
        oidcTab().oidcClientId.set('client-2');
        void oidcTab().saveOidc();
        confirm().answer(true);
        await settle();
        respond({
          'PUT /settings/oidc': fail(403, 'Ehhez a művelethez újra azonosítanod kell magad.', {
            code: 'fresh-login-required',
          }),
        });
        respond({
          'GET /auth/me': { loggedIn: true, id: 'me', role: 'admin', canManageRoles: true },
        });
        await settle();
        expect(confirm().pending()?.message).toBe(asking);
        expect(error).not.toHaveBeenCalled();
      });
    });

    it("what is still only in the server's .env can be saved as it is", () => {
      asOwner({ ...oidc, source: 'env' });
      expect(oidcTab().oidcDirty()).toBe(false);
      expect(oidcTab().oidcNotSavedYet()).toBe(true);
      expect(fixture.nativeElement.querySelector('.danger-btn').disabled).toBe(false);
    });

    it('nothing can be saved while the server has no key for the secrets', () => {
      asOwner({ ...oidc, source: 'env', canSave: false });
      expect(fixture.nativeElement.textContent).toContain('APP_SECRET_KEY');
      expect(fixture.nativeElement.querySelector('.oidc-authentik .danger-btn').disabled).toBe(
        true,
      );
    });

    it('once saved here, says the .env lines can go; the way back in is the emergency login', () => {
      asOwner();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('törölhetők');
      expect(text).toContain('LOCAL_LOGIN=true');
    });

    describe('other providers next to Authentik', () => {
      const confirm = () => TestBed.inject(ConfirmService);
      const rows = () =>
        [...fixture.nativeElement.querySelectorAll('.oidc-provider-list li')] as HTMLElement[];

      it('lists Authentik first, marks the active one, and opens the one clicked', () => {
        asOwner({ ...oidc, providers: [other] });
        expect(rows().map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
          'Oridzsinátor aktív',
          'Másik',
        ]);
        expect(fixture.nativeElement.querySelector('.oidc-authentik').hidden).toBe(false);

        rows()[1].querySelector('button')!.click();
        fixture.detectChanges();
        expect(oidcTab().oidcOpen()).toBe('p1');
        expect(fixture.nativeElement.querySelector('.oidc-authentik').hidden).toBe(true);
        expect(oidcTab().pIssuerUrl()).toBe('https://id.test/realms/klub');
        expect(oidcTab().pClientSecret()).toBe('');
        expect(oidcTab().providerDirty()).toBe(false);
      });

      it('adds a new one after a yes, and opens it', async () => {
        asOwner();
        oidcTab().openProvider('new');
        expect(oidcTab().providerDirty()).toBe(false);
        oidcTab().pName.set(' Másik ');
        oidcTab().pIssuerUrl.set('https://id.test/realms/klub');
        oidcTab().pClientId.set('klub-app');
        oidcTab().pClientSecret.set('secret');

        void oidcTab().saveProvider();
        confirm().answer(false);
        await settle();
        http.expectNone(`${API}/settings/oidc/providers`);

        void oidcTab().saveProvider();
        confirm().answer(true);
        await settle();
        const req = http.expectOne(`${API}/settings/oidc/providers`);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({
          name: 'Másik',
          issuerUrl: 'https://id.test/realms/klub',
          clientId: 'klub-app',
          clientSecret: 'secret',
          postLogoutRedirectUri: '',
          requireVerifiedEmail: true,
        });
        req.flush({ data: { ...oidc, providers: [other], created: 'p1' } });
        expect(success).toHaveBeenCalledWith('Másik mentve.');
        expect(oidcTab().oidcOpen()).toBe('p1');
        expect(oidcTab().pClientSecret()).toBe('');
      });

      it('changes one (an empty secret is sent empty), and shows a refusal', async () => {
        asOwner({ ...oidc, providers: [other] });
        oidcTab().openProvider('p1');
        oidcTab().pVerifiedOnly.set(false);
        void oidcTab().saveProvider();
        confirm().answer(true);
        await settle();
        const req = http.expectOne(`${API}/settings/oidc/providers/p1`);
        expect(req.request.method).toBe('PUT');
        expect(req.request.body).toMatchObject({ clientSecret: '', requireVerifiedEmail: false });
        req.flush({ data: { ...oidc, providers: [{ ...other, requireVerifiedEmail: false }] } });
        expect(oidcTab().providerDirty()).toBe(false);

        oidcTab().pIssuerUrl.set('https://typo.test');
        void oidcTab().saveProvider();
        confirm().answer(true);
        await settle();
        respond({ 'PUT /settings/oidc/providers/p1': fail(400, 'A szolgáltató nem válaszol.') });
        expect(error).toHaveBeenCalledWith('A szolgáltató nem válaszol.');
        expect(oidcTab().savingProvider()).toBe(false);
      });

      it('the radio button makes one the active only after a yes', async () => {
        asOwner({ ...oidc, providers: [other] });
        const radio = rows()[1].querySelector('input') as HTMLInputElement;
        radio.click();
        confirm().answer(false);
        await settle();
        http.expectNone(`${API}/settings/oidc/active`);

        radio.click();
        expect(confirm().pending()?.title).toBe('VESZÉLYES ZÓNA!!!');
        confirm().answer(true);
        await settle();
        const req = http.expectOne(`${API}/settings/oidc/active`);
        expect(req.request.body).toEqual({ provider: 'p1' });
        req.flush({ data: { ...oidc, active: 'p1', providers: [other] } });
        fixture.detectChanges();
        expect(success).toHaveBeenCalledWith('Az aktív szolgáltató: Másik.');
        expect(rows()[1].textContent).toContain('aktív');

        // The one already active: nothing to ask.
        void oidcTab().activateProvider('p1');
        await settle();
        expect(confirm().pending()).toBeNull();

        void oidcTab().activateProvider('authentik');
        confirm().answer(true);
        await settle();
        respond({ 'PUT /settings/oidc/active': fail(400, 'Nem válaszol.') });
        expect(error).toHaveBeenCalledWith('Nem válaszol.');
        expect(oidcTab().oidc()?.active).toBe('p1');
      });

      it('deletes one after a yes - but the active one has no working delete button', async () => {
        asOwner({ ...oidc, active: 'p1', providers: [other] });
        oidcTab().openProvider('p1');
        fixture.detectChanges();
        const button = fixture.nativeElement.querySelector(
          '.oidc-other .actions .outline-btn',
        ) as HTMLButtonElement;
        expect(button.disabled).toBe(true);

        oidcTab().oidc.set({ ...oidcTab().oidc()!, active: 'authentik' });
        void oidcTab().deleteProvider('p1');
        confirm().answer(true);
        await settle();
        const req = http.expectOne(`${API}/settings/oidc/providers/p1`);
        expect(req.request.method).toBe('DELETE');
        req.flush({ data: oidc });
        expect(success).toHaveBeenCalledWith('Másik törölve.');
        expect(oidcTab().oidcOpen()).toBe('authentik');

        void oidcTab().deleteProvider('nincs'); // not there: nothing happens
        await settle();
        expect(confirm().pending()).toBeNull();
      });
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
      app().previewBirthday();
      expect(play).toHaveBeenCalledWith('confetti', 'Boldog, Elek!');
      app().bdMessage.set('  ');
      app().previewBirthday();
      expect(play).toHaveBeenLastCalledWith('confetti', 'Boldog születésnapot, Elek! 🎂');
    });

    it('previews the rank greeting with sample values', () => {
      app().previewRank();
      expect(play).toHaveBeenCalledWith('stars', 'Elek: Bronz', 'rank');
      app().rkMessage.set('');
      app().previewRank();
      expect(play).toHaveBeenLastCalledWith('stars', 'Kedves Elek! Túléltél 10 bódorgót!', 'rank');
    });

    it('saves the birthday card', () => {
      app().bdMessage.set(' Isten éltessen! ');
      expect(app().birthdayDirty()).toBe(true);
      app().resetBirthday();
      expect(app().birthdayDirty()).toBe(false);

      app().bdEffect.set('snow');
      app().saveBirthday();
      app().saveBirthday();
      const req = http.expectOne(`${API}/settings/birthday`);
      expect(req.request.body).toEqual({
        enabled: true,
        effect: 'snow',
        message: 'Boldog, {név}!',
      });
      req.flush({ data: req.request.body });
      expect(success).toHaveBeenCalledWith('Születésnap beállítás mentve.');

      app().saveBirthday();
      respond({ 'PUT /settings/birthday': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('saves the rank card', () => {
      app().rkEnabled.set(true);
      expect(app().rankDirty()).toBe(true);
      app().resetRank();
      expect(app().rankDirty()).toBe(false);

      app().rkEnabled.set(true);
      app().saveRank();
      app().saveRank();
      const req = http.expectOne(`${API}/settings/rank`);
      req.flush({ data: req.request.body });
      expect(success).toHaveBeenCalledWith('Rangok ünneplése mentve.');

      app().saveRank();
      respond({ 'PUT /settings/rank': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });
  });

  it('saves the president, which also refreshes the seal', () => {
    open();
    club().presidentName.set(' Új Elnök ');
    expect(club().presidentDirty()).toBe(true);
    club().savePresident();
    club().savePresident();
    const req = http.expectOne(`${API}/settings/president`);
    expect(req.request.body).toEqual({ presidentName: 'Új Elnök' });
    req.flush({ data: { presidentName: 'Új Elnök' } });
    expect(success).toHaveBeenCalledWith('Elnök mentve.');
    expect(club().sealUrl()).toContain('%C3%9Aj%20Eln%C3%B6k');

    club().savePresident();
    respond({ 'PUT /settings/president': fail() });
    expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
  });
});

describe('BankAccount', () => {
  let fixture: ComponentFixture<BankAccount>;
  let card: BankAccount;
  let http: HttpTestingController;

  function open(wallet: 'membership' | 'tour', routes: Record<string, object> = loaded()) {
    fixture = TestBed.createComponent(BankAccount);
    fixture.componentRef.setInput('wallet', wallet);
    card = fixture.componentInstance;
    fixture.detectChanges();
    respond(routes);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BankAccount], providers: [pageTesting()] });
    http = TestBed.inject(HttpTestingController);
    // An admin who identified themselves just now (see fresh-login.service.ts).
    logIn({ role: 'admin' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the account of the membership fees', () => {
    open('membership');
    expect(card.title()).toBe('Tagdíjak');
    expect(card.account()?.payeeEmail).toBe('tag@klub.hu');
    expect(fixture.nativeElement.textContent).toContain('HU11');
  });

  it('opens even when nothing could be loaded', async () => {
    open('tour', { 'GET /settings/barion': fail() });
    expect(card.title()).toBe('Előlegek');
    expect(card.account()).toBeNull();
    await card.startEdit();
    expect(card.form).toEqual({ payeeEmail: '', withdrawName: '', withdrawIban: '' });
  });

  it('edits the account and tells the page it was saved', async () => {
    open('membership');
    const saved = vi.fn();
    card.saved.subscribe(saved);
    await card.startEdit();
    expect(card.form.withdrawIban).toBe('HU11');
    card.form.withdrawIban = 'HU22';
    card.save();
    card.save();
    const req = http.expectOne(`${API}/settings/barion/membership`);
    expect(req.request.body.withdrawIban).toBe('HU22');
    req.flush({ data: req.request.body });
    expect(card.editing()).toBe(false);
    expect(card.account()?.withdrawIban).toBe('HU22');
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ withdrawIban: 'HU22' }));
  });

  it('keeps the form open with the reason when the save fails', async () => {
    open('membership');
    await card.startEdit();
    card.save();
    respond({ 'PUT /settings/barion/membership': fail(400, 'Hibás IBAN.') });
    expect(card.formError()).toBe('Hibás IBAN.');
    expect(card.editing()).toBe(true);
  });

  describe('someone who logged in long ago', () => {
    const confirm = () => TestBed.inject(ConfirmService);

    beforeEach(() => {
      logIn({ role: 'admin', freshLoginSecondsLeft: 0 });
      open('membership');
    });
    afterEach(() => sessionStorage.clear());

    it('saying no leaves everything as it was', async () => {
      const go = vi
        .spyOn(TestBed.inject(AuthService), 'identifyAgain')
        .mockImplementation(() => {});
      void card.startEdit();
      respond({ 'GET /auth/me': { loggedIn: true, id: 'me', role: 'admin' } });
      await settle();
      confirm().answer(false);
      await settle();
      expect(go).not.toHaveBeenCalled();
      expect(card.editing()).toBe(false);
    });

    it('goes on without asking if they identified since (on another tab)', async () => {
      void card.startEdit();
      respond({
        'GET /auth/me': { loggedIn: true, id: 'me', role: 'admin', freshLoginSecondsLeft: 400 },
      });
      await settle();
      expect(confirm().pending()).toBeNull();
      expect(card.editing()).toBe(true);
    });
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
    // An admin who identified themselves just now (see fresh-login.service.ts).
    logIn({ role: 'admin' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows the membership wallet's balance", () => {
    open('membership', {
      'GET /payments/withdraw/membershipFee': {
        data: {
          configured: true,
          balance: { available: 12000, blocked: 500 },
          balanceError: false,
        },
      },
    });
    expect(card.title()).toBe('Tagdíjak');
    expect(card.configured()).toBe(true);
    expect(card.balance()).toEqual({ available: 12000, blocked: 500 });
    expect(fixture.nativeElement.textContent).toContain('500 Ft zárolva');
  });

  it('says so when Barion could not be asked for the balance', () => {
    open('membership', {
      'GET /payments/withdraw/membershipFee': {
        data: { configured: true, balance: null, balanceError: true },
      },
    });
    expect(fixture.nativeElement.textContent).toContain('most nem sikerült lekérdezni');
  });

  it('asks again whether it can pay out when the page says an account was saved', () => {
    open('membership');
    fixture.componentRef.setInput('refresh', 1);
    fixture.detectChanges();
    respond({ 'GET /payments/withdraw/membershipFee': { data: { configured: false } } });
    expect(card.configured()).toBe(false);
  });

  it('shows the wallet of the tour advances', () => {
    open('tour');
    expect(card.title()).toBe('Előlegek');
    expect(card.configured()).toBe(false);
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

  it('withdraws and reports what arrived', async () => {
    open('membership');
    await card.withdraw(); // no amount yet
    http.expectNone(`${API}/payments/withdraw`);

    card.amount.set(10000);
    void card.withdraw();
    void card.withdraw();
    await settle();
    const req = http.expectOne(`${API}/payments/withdraw`);
    expect(req.request.body).toEqual({ purpose: 'membershipFee', amount: 10000 });
    req.flush({ data: { fee: 70, net: 9930 } });
    expect(card.notice()?.kind).toBe('success');
    // hu-HU groups thousands only from five digits up
    expect(card.notice()?.text).toBe('Sikeres kiutalás: 9930 Ft nettó (70 Ft díj levonva).');
    expect(card.amount()).toBeNull();
  });

  it('reports a failed withdrawal', async () => {
    open('membership');
    card.amount.set(500);
    await card.withdraw();
    respond({ 'POST /payments/withdraw': fail(400, 'Nincs elég egyenleg.') });
    expect(card.notice()).toEqual({ kind: 'error', text: 'Nincs elég egyenleg.' });
    expect(card.withdrawing()).toBe(false);
  });

  describe('someone who logged in long ago', () => {
    const confirm = () => TestBed.inject(ConfirmService);
    const identify = () =>
      vi.spyOn(TestBed.inject(AuthService), 'identifyAgain').mockImplementation(() => {});
    // The server is asked once more whether they identified since.
    const stillOld = () => respond({ 'GET /auth/me': { loggedIn: true, id: 'me', role: 'admin' } });

    beforeEach(() => {
      logIn({ role: 'admin', freshLoginSecondsLeft: 0 });
      open('membership');
    });
    afterEach(() => sessionStorage.clear());

    it('is asked to identify again before a payout - and nothing is sent', async () => {
      const go = identify();
      card.amount.set(10000);
      void card.withdraw();
      stillOld();
      await settle();
      expect(confirm().pending()).toMatchObject({
        title: 'Azonosítás szükséges',
        message: 'Kiutalás a számlára: ehhez újra azonosítanod kell magad.',
        confirmText: 'Azonosítás',
      });
      confirm().answer(true);
      await settle();
      // On to the provider, and back to this same page.
      expect(go).toHaveBeenCalledWith(TestBed.inject(Router).url);
      http.expectNone(`${API}/payments/withdraw`);
      expect(card.withdrawing()).toBe(false);
    });
  });
});
