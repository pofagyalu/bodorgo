import { Type } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { API } from '../../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../../testing/component';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { BirthdayService } from '../../../shared/birthday/birthday.service';
import { BarionWithdraw } from './barion-withdraw/barion-withdraw';
import { KlubSettings, TAB_KEYS } from './settings';
import { OidcSettingsTab } from './oidc-settings/oidc-settings';
import { ClubSettingsTab } from './club-settings/club-settings';
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

  // Each tab is a component of its own inside the page.
  const tab = <T>(type: Type<T>) =>
    fixture.debugElement.query(By.directive(type)).componentInstance as T;
  const club = () => tab(ClubSettingsTab);
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
    expect(app().reminder()?.enabled).toBe(true);
    expect(app().reminderRecipients()).toEqual(['Tag Tamás']);
    expect(club().payForm()?.barion.feeMin).toBe(100);
    expect(club().chatImages()?.quotaMB).toBe(100);
    expect(club().imageCache()?.quotaMB).toBe(1000);
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
    expect(hidden()).toEqual([false, true, true]);

    fixture.nativeElement.querySelectorAll('[role="tab"]')[2].click();
    fixture.detectChanges();
    expect(page.activeTab()).toBe('info');
    expect(hidden()).toEqual([true, true, false]);
    expect(navigate.mock.calls[0][1]).toMatchObject({ queryParams: { lap: TAB_KEYS.info } });
  });

  it('still opens when the requests fail', () => {
    const routes = Object.fromEntries(Object.keys(loaded()).map((key) => [key, fail(500)]));
    open({ ...routes, 'GET /settings/membership-fees': fail(403, 'Nincs jogod.') });
    expect(club().loading()).toBe(false);
    expect(app().reminderLoading()).toBe(false);
    expect(error).toHaveBeenCalledWith('Nincs jogod.');
    expect(club().chatUsagePercent()).toBe(0);
    expect(club().imageCachePercent()).toBe(0);
    expect(club().payExample('stripe', 1000)).toBe('1000'); // no method known: no fee
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

    it('saves the rows sorted by year and reloads the history', () => {
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
          data: { fees: [], foundingYear: 2019, history: [], paidYears: [2020, 2021] },
        },
      });
      expect(club().paidYears()).toEqual([2020, 2021]);
      expect(club().history()).toEqual([]);
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
      expect(app().previewDates()).toEqual([
        'március 1.',
        'június 1.',
        'szeptember 1.',
        'december 1.',
      ]);
      app().reminderFrequency.set('monthly');
      app().reminderMonth.set(11);
      app().reminderDay.set(15);
      expect(app().previewDates()).toEqual(['november 15.', 'december 15.']);
      expect(app().roundLabel('2026-06-01')).toBe('június 1.');
    });

    it('is dirty after a change and clean again after a reset', () => {
      expect(app().reminderDirty()).toBe(false);
      app().reminderEnabled.set(false);
      expect(app().reminderDirty()).toBe(true);
      app().resetReminder();
      expect(app().reminderDirty()).toBe(false);
    });

    it('saves the form', () => {
      app().reminderDay.set(5);
      app().saveReminder();
      app().saveReminder();
      const req = http.expectOne(`${API}/settings/membership-reminder`);
      expect(req.request.body).toEqual({
        enabled: true,
        startMonth: 3,
        startDay: 5,
        frequency: 'quarterly',
      });
      req.flush({ data: { reminder: { ...app().reminder()!, startDay: 5 } } });
      expect(success).toHaveBeenCalledWith('Tagdíj emlékeztető mentve.');
      expect(app().reminderDirty()).toBe(false);
    });

    it('reports a failed save and a failed test e-mail', () => {
      app().saveReminder();
      respond({ 'PUT /settings/membership-reminder': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
      app().sendTestReminder();
      respond({ 'POST /settings/membership-reminder/test': fail(500, 'Nincs SMTP.') });
      expect(error).toHaveBeenCalledWith('Nincs SMTP.');
      expect(app().sendingTest()).toBe(false);
    });

    it('sends a test e-mail to the admin', () => {
      app().sendTestReminder();
      app().sendTestReminder();
      respond({ 'POST /settings/membership-reminder/test': { data: { sentTo: 'a@b.hu' } } });
      expect(success).toHaveBeenCalledWith('Próba e-mail elküldve: a@b.hu');
    });
  });

  describe('chat photos and the image cache', () => {
    beforeEach(() => open());

    it('shows how full they are, capped at 100%', () => {
      expect(club().chatUsagePercent()).toBe(25);
      expect(club().chatUsageMB()).toBe(25);
      expect(club().imageCachePercent()).toBe(100);
      expect(club().imageCacheUsageMB()).toBe(2000);
    });

    it('saves the chat photo limits and says how many photos had to go', () => {
      club().chatQuotaMB.set(10);
      expect(club().chatImagesDirty()).toBe(true);
      club().saveChatImages();
      club().saveChatImages();
      const usage = { bytes: 9 * MB, count: 2 };
      respond({
        'PUT /settings/chat-images': { data: { quotaMB: 10, dailyLimit: 10, usage, removed: 2 } },
      });
      expect(success).toHaveBeenCalledWith(
        'Kotyogó fotók mentve – 2 régi fotó törölve, hogy beférjen.',
      );
      expect(club().chatImagesDirty()).toBe(false);

      club().saveChatImages();
      respond({
        'PUT /settings/chat-images': { data: { quotaMB: 10, dailyLimit: 10, usage, removed: 0 } },
      });
      expect(success).toHaveBeenLastCalledWith('Kotyogó fotók mentve.');

      club().saveChatImages();
      respond({ 'PUT /settings/chat-images': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('saves the cache size', () => {
      club().imageCacheQuotaMB.set(3000);
      expect(club().imageCacheDirty()).toBe(true);
      club().saveImageCache();
      club().saveImageCache();
      const usage = { bytes: 0, count: 0 };
      respond({ 'PUT /settings/image-cache': { data: { quotaMB: 3000, usage, removed: 5 } } });
      expect(success.mock.calls.at(-1)![0]).toContain('5 régóta nem nézett kép törölve');

      club().saveImageCache();
      respond({ 'PUT /settings/image-cache': { data: { quotaMB: 3000, usage, removed: 0 } } });
      expect(success).toHaveBeenLastCalledWith('Kép gyorsítótár mentve.');

      club().saveImageCache();
      respond({ 'PUT /settings/image-cache': fail() });
      expect(error).toHaveBeenCalledWith('A mentés nem sikerült.');
    });

    it('empties the cache only after a yes', async () => {
      const confirm = TestBed.inject(ConfirmService);
      void club().clearImageCache();
      confirm.answer(false);
      await settle();
      http.expectNone(`${API}/settings/image-cache`);

      void club().clearImageCache();
      confirm.answer(true);
      await settle();
      respond({
        'DELETE /settings/image-cache': {
          data: { quotaMB: 1000, usage: { bytes: 0, count: 0 }, removed: 9 },
        },
      });
      expect(success).toHaveBeenCalledWith('Kép gyorsítótár kiürítve – 9 kép törölve.');
      expect(club().imageCachePercent()).toBe(0);

      void club().clearImageCache();
      confirm.answer(true);
      await settle();
      respond({ 'DELETE /settings/image-cache': fail() });
      expect(error).toHaveBeenCalledWith('Az ürítés nem sikerült.');
    });
  });

  describe('payment methods', () => {
    beforeEach(() => open());

    it('edits one method without touching the other', () => {
      club().setPayField('stripe', 'feePercent', '3.5');
      club().setPayField('stripe', 'enabled', 0);
      expect(club().payForm()?.stripe).toMatchObject({ feePercent: 3.5, enabled: false });
      expect(club().payMethodDirty('stripe')).toBe(true);
      expect(club().payMethodDirty('barion')).toBe(false);
      club().resetPayMethod('stripe');
      expect(club().payMethodDirty('stripe')).toBe(false);
    });

    it('shows what a payer would pay with the fee on top', () => {
      const digits = (text: string) => text.replace(/\D/g, '');
      expect(digits(club().payExample('stripe', 10000))).toBe('10204');
      expect(digits(club().payExample('barion', 1000))).toBe('1100'); // the minimum fee
    });

    it('saves a method', () => {
      club().setPayField('barion', 'feeFixed', 50);
      club().savePayMethod('barion');
      club().savePayMethod('stripe'); // one save at a time
      const req = http.expectOne(`${API}/settings/payment-methods/barion`);
      req.flush({ data: req.request.body });
      expect(success).toHaveBeenCalledWith('Barion beállítás mentve.');
      expect(club().payMethodDirty('barion')).toBe(false);
      respond({ 'GET /settings/membership-fees': { data: { fees: [], foundingYear: 2019 } } });
      expect(club().history()).toEqual([]);

      club().savePayMethod('stripe');
      respond({ 'PUT /settings/payment-methods/stripe': fail(400, 'Túl nagy díj.') });
      expect(error).toHaveBeenCalledWith('Túl nagy díj.');
      expect(club().savingPayMethod()).toBeNull();
    });
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
          'Authentik aktív',
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
