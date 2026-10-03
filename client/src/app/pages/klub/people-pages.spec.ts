import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { API } from '../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../testing/component';
import { NotificationsService } from '../../notifications/notifications.service';
import { PushService, PushState } from '../../services/push';
import { AdminUser } from '../../services/user';
import { AuthService } from '../../auth/auth.service';
import { MemberEdit } from './member-edit/member-edit';
import { KlubProfile } from './profile/profile';

let http: HttpTestingController;
let success: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function spies() {
  http = TestBed.inject(HttpTestingController);
  const notifications = TestBed.inject(NotificationsService);
  success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
  error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => vi.restoreAllMocks());

describe('MemberEdit', () => {
  let fixture: ComponentFixture<MemberEdit>;
  let page: MemberEdit;
  let navigate: ReturnType<typeof vi.spyOn>;

  const USER: AdminUser = {
    _id: 'u1',
    name: 'Teszt Kata',
    username: 'kata',
    email: 'kata@x.hu',
    familyId: 'f1',
    role: 'member',
    createdAt: '2020-01-01',
    birthday: '1990-05-17T00:00:00.000Z',
    gender: 'nő',
    memberSince: 2021,
    weightKg: 60,
    photoSetBy: 'self',
    address: { zipCode: '1111', city: 'Budapest', street: 'Fő u. 1.' },
  };

  function open(id: string | null, query: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [MemberEdit],
      providers: [
        pageTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(id ? { id } : {}),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
      ],
    });
    spies();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(MemberEdit);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('fills the form from the user', () => {
    open('u1');
    expect(page.loading()).toBe(true);
    respond({ 'GET /users/u1': { data: { user: USER } } });
    fixture.detectChanges();
    expect(page.loading()).toBe(false);
    expect(page.name()).toBe('Teszt Kata');
    expect(page.birthday()).toBe('1990-05-17');
    expect(page.memberSince()).toBe('2021');
    expect(page.weightKg()).toBe('60');
    expect(page.address()).toEqual({
      zipCode: '1111',
      city: 'Budapest',
      street: 'Fő u. 1.',
      country: 'Magyarország',
    });
  });

  it('leaves the optional fields empty for a user who has none', () => {
    open('u1');
    respond({
      'GET /users/u1': { data: { user: { _id: 'u1', name: 'Új', role: 'guest', createdAt: '' } } },
    });
    expect(page.email()).toBe('');
    expect(page.birthday()).toBe('');
    expect(page.memberSince()).toBe('');
    expect(page.address().country).toBe('Magyarország');
  });

  it('reports a user that cannot be loaded', () => {
    open('u1');
    respond({ 'GET /users/u1': fail(404, 'Nincs ilyen felhasználó.') });
    expect(error).toHaveBeenCalledWith('Nincs ilyen felhasználó.');
    expect(page.loading()).toBe(false);
  });

  it('lets only the role manager change a role, and never their own', () => {
    open('u1');
    respond({ 'GET /users/u1': { data: { user: USER } } });
    logIn({ id: 'boss', role: 'admin' });
    expect(page.canEditRole()).toBe(false);
    expect(page.roleHint()).toContain('csak a szerepkör-kezelő admin');

    logIn({ id: 'boss', role: 'admin', canManageRoles: true });
    expect(page.canEditRole()).toBe(true);
    expect(page.roleHint()).toBe('A szerepkört csak te módosíthatod.');

    logIn({ id: 'u1', role: 'admin', canManageRoles: true });
    expect(page.canEditRole()).toBe(false);
    expect(page.roleHint()).toBe('A saját szerepköröd nem módosíthatod.');
  });

  it('does not let an admin replace a photo the user set themselves', () => {
    open('u1');
    expect(page.photoLocked()).toBe(false); // nobody loaded yet
    respond({ 'GET /users/u1': { data: { user: USER } } });
    logIn({ id: 'boss', role: 'admin' });
    expect(page.photoLocked()).toBe(true);
    logIn({ id: 'u1', role: 'admin' });
    expect(page.photoLocked()).toBe(false);
  });

  it('takes over a changed photo, in the header too when it is my own', () => {
    open('u1');
    respond({ 'GET /users/u1': { data: { user: USER } } });
    logIn({ id: 'u1', role: 'admin' });
    page.onPhotoChanged({ photoUpdatedAt: 'now', photoSetBy: 'admin' });
    expect(page.user()?.photoUpdatedAt).toBe('now');
    expect(TestBed.inject(AuthService).user()?.photoUpdatedAt).toBe('now');
  });

  it('saves the changes and goes back to the list it came from', () => {
    open('u1', { lista: 'mindenki' });
    respond({ 'GET /users/u1': { data: { user: USER } } });
    page.updateAddress('city', 'Szeged');
    page.memberSince.set('');
    page.save();
    page.save(); // one save at a time
    const req = http.expectOne(`${API}/users/u1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toMatchObject({
      email: 'kata@x.hu',
      username: 'kata',
      birthday: '1990-05-17',
      memberSince: null,
      weightKg: 60,
      role: 'member',
      address: { city: 'Szeged' },
    });
    req.flush({ data: { user: USER, addressResolved: true } });
    expect(success).toHaveBeenCalledWith('Felhasználó mentve');
    expect(navigate).toHaveBeenCalledWith(['/klub/felhasznalok'], {
      queryParams: { lista: 'mindenki' },
    });
  });

  it('stays on the page when the address was not found on the map', () => {
    open('u1');
    respond({ 'GET /users/u1': { data: { user: USER } } });
    page.save();
    respond({ 'PATCH /users/u1': { data: { user: USER, addressResolved: false } } });
    expect(error.mock.calls[0][0]).toContain('A cím nem található');
    expect(navigate).not.toHaveBeenCalled();
    expect(page.saving()).toBe(false);
  });

  it('reports a failed save', () => {
    open('u1');
    respond({ 'GET /users/u1': { data: { user: USER } } });
    page.save();
    respond({ 'PATCH /users/u1': fail(400, 'Ez a felhasználónév foglalt.') });
    expect(error).toHaveBeenCalledWith('Ez a felhasználónév foglalt.');
    expect(page.saving()).toBe(false);
  });

  it('creates a new user, needing only a name', () => {
    open(null);
    expect(page.isCreateMode).toBe(true);
    expect(page.loading()).toBe(false);
    page.save();
    expect(error).toHaveBeenCalledWith('A névnek nem lehet üres.');

    page.name.set(' Új Ember ');
    page.weightKg.set('75');
    page.memberSince.set('2024');
    page.save();
    const req = http.expectOne(`${API}/users`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      name: 'Új Ember',
      role: 'guest',
      weightKg: 75,
      memberSince: 2024,
    });
    expect(req.request.body.email).toBeUndefined();
    req.flush({ data: { user: USER } });
    expect(success).toHaveBeenCalledWith('Felhasználó létrehozva');
    expect(navigate).toHaveBeenCalledWith(['/klub/felhasznalok'], {});
  });

  it('reports a failed create', () => {
    open(null);
    page.name.set('Új Ember');
    page.save();
    respond({ 'POST /users': fail() });
    expect(error).toHaveBeenCalledWith('Hiba történt a létrehozás során.');
    expect(page.saving()).toBe(false);
  });

  it('formats a date with its time in Hungarian', () => {
    open(null);
    expect(page.formatDateTime('2026-03-05T14:07:00')).toBe('2026. március 5. 14:07');
  });
});

describe('KlubProfile', () => {
  let fixture: ComponentFixture<KlubProfile>;
  let page: KlubProfile;
  let push: PushService;

  const tour = (order: number, startDate: string, duration = 3) => ({
    tour: {
      _id: `t${order}`,
      title: `Tábor ${order}`,
      slug: `t${order}`,
      order,
      startDate,
      duration,
    },
    paid: true,
    paymentId: null,
    paymentMethod: null,
  });
  const nextYear = new Date().getFullYear() + 1;

  const loaded = (): Record<string, object> => ({
    'GET /users/me': {
      data: {
        _id: 'me',
        name: 'Teszt Elek',
        username: 'elek',
        age: 40,
        toursAttended: 3,
        wantsEmailNotifications: true,
        photoUpdatedAt: null,
        photoSetBy: null,
        futokod: null,
        address: { city: 'Budapest' },
      },
    },
    'GET /users/me/attendance': {
      data: {
        tours: [
          tour(1, '2019-07-01'),
          tour(3, '2021-08-01'),
          tour(2, '2021-06-01'),
          tour(9, `${nextYear}-07-01`),
          tour(8, `${nextYear}-05-01`),
        ],
      },
    },
    'GET /users/me/family': {
      data: { members: [{ _id: 'kid', name: 'Teszt Kata', role: 'member' }] },
    },
  });

  function open(routes = loaded(), state: PushState = 'off') {
    TestBed.configureTestingModule({ imports: [KlubProfile], providers: [pageTesting()] });
    spies();
    push = TestBed.inject(PushService);
    vi.spyOn(push, 'refresh').mockImplementation(async () => {
      push.state.set(state);
      return state;
    });
    logIn({ id: 'me', role: 'member' });
    fixture = TestBed.createComponent(KlubProfile);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond(routes);
    fixture.detectChanges();
  }

  it('shows my data, my camps and my family', () => {
    open();
    expect(page.loading()).toBe(false);
    expect(page.usernameDraft()).toBe('elek');
    expect(page.address()).toEqual({
      zipCode: '',
      city: 'Budapest',
      street: '',
      country: 'Magyarország',
    });
    expect(page.family()).toHaveLength(1);
    expect(page.attendanceSummary()).toBe('5 tábor · 2019 óta');
  });

  it('lists the coming camps soonest first and the past ones by year, newest first', () => {
    open();
    expect(page.upcomingTours().map((r) => r.tour.order)).toEqual([8, 9]);
    expect(page.pastByYear().map((g) => [g.year, g.rows.map((r) => r.tour.order)])).toEqual([
      [2021, [3, 2]],
      [2019, [1]],
    ]);
  });

  it('says what could not be loaded', () => {
    open({
      'GET /users/me': fail(),
      'GET /users/me/attendance': fail(),
      'GET /users/me/family': fail(),
    });
    expect(page.loading()).toBe(false);
    expect(page.profile()).toBeNull();
    expect(page.attendanceError()).toBe('A táboraid betöltése nem sikerült.');
    expect(page.familyError()).toBe('A hozzátartozók betöltése nem sikerült.');
    expect(page.attendanceSummary()).toBe('');
    page.toggleEmailNotifications(); // nothing to toggle without a profile
    http.expectNone(`${API}/users/updateMe`);
  });

  it('saves the username and the address, and tells whether the address was found', () => {
    open();
    page.usernameDraft.set('  ');
    page.saveProfile();
    expect(error).toHaveBeenCalledWith('A felhasználónév nem lehet üres.');

    page.usernameDraft.set(' bodri ');
    page.updateAddress('zipCode', '6720');
    page.saveProfile();
    const req = http.expectOne(`${API}/users/updateMe`);
    expect(req.request.body).toMatchObject({ username: 'bodri', address: { zipCode: '6720' } });
    req.flush({ data: { user: {}, addressResolved: false } });
    expect(page.profile()?.username).toBe('bodri');
    expect(page.addressResolved()).toBe(false);
    expect(success).toHaveBeenCalledWith('Profil mentve');

    page.saveProfile();
    respond({ 'PATCH /users/updateMe': { data: { user: {} } } });
    expect(page.addressResolved()).toBeNull();

    page.saveProfile();
    respond({ 'PATCH /users/updateMe': fail(400, 'Ez a felhasználónév foglalt.') });
    expect(error).toHaveBeenCalledWith('Ez a felhasználónév foglalt.');
    expect(page.saving()).toBe(false);
  });

  it('switches the e-mail notifications', () => {
    open();
    page.toggleEmailNotifications();
    const req = http.expectOne(`${API}/users/updateMe`);
    expect(req.request.body).toEqual({ wantsEmailNotifications: false });
    req.flush({ data: {} });
    expect(page.profile()?.wantsEmailNotifications).toBe(false);
    expect(success).toHaveBeenCalledWith('Beállítás mentve');

    page.toggleEmailNotifications();
    respond({ 'PATCH /users/updateMe': fail() });
    expect(error).toHaveBeenCalledWith('Hiba történt a mentés során.');
    expect(page.profile()?.wantsEmailNotifications).toBe(false);
    expect(page.savingNotifications()).toBe(false);
  });

  it('takes over a changed photo, in the header too', () => {
    open();
    page.onPhotoChanged({ photoUpdatedAt: 'now', photoSetBy: 'self' });
    expect(page.profile()?.photoUpdatedAt).toBe('now');
    expect(TestBed.inject(AuthService).user()?.photoUpdatedAt).toBe('now');
  });

  it('switches the push notifications of this device on and off', async () => {
    open();
    const enable = vi.spyOn(push, 'enable').mockImplementation(async () => push.state.set('on'));
    const disable = vi.spyOn(push, 'disable').mockImplementation(async () => push.state.set('off'));

    const first = page.togglePush();
    void page.togglePush(); // ignored while busy
    await first;
    expect(enable).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('Értesítések bekapcsolva ezen az eszközön.');

    await page.togglePush();
    expect(disable).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('Értesítések kikapcsolva ezen az eszközön.');
    expect(page.pushBusy()).toBe(false);
  });

  it('shows why the push notifications could not be switched on', async () => {
    open();
    vi.spyOn(push, 'enable').mockRejectedValue(new Error('Az értesítések nincsenek engedélyezve.'));
    await page.togglePush();
    await settle();
    expect(error).toHaveBeenCalledWith('Az értesítések nincsenek engedélyezve.');
    expect(page.pushBusy()).toBe(false);
  });

  it('sends a test notification', () => {
    open();
    page.sendTestPush();
    respond({ 'POST /push/test': { data: { sent: 1 } } });
    expect(success.mock.calls.at(-1)![0]).toContain('Próbaértesítés elküldve');

    page.sendTestPush();
    respond({ 'POST /push/test': fail(400, 'Nincs feliratkozott eszközöd.') });
    expect(error).toHaveBeenCalledWith('Nincs feliratkozott eszközöd.');
    expect(page.pushBusy()).toBe(false);
  });

  it('formats dates and builds the receipt link', () => {
    open();
    expect(page.formatDate('2026-03-05T14:07:00')).toBe('2026. március 5.');
    expect(page.formatDateTime('2026-03-05T14:07:00')).toBe('2026. március 5. 14:07');
    expect(page.receiptUrl('p1')).toBe(`${API}/payments/p1/receipt`);
  });
});
