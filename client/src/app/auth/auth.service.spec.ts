import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  const answerMe = (body: object) => {
    service.checkAuth().subscribe();
    http.expectOne(`${API}/auth/me`).flush(body);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts logged out', () => {
    expect(service.isLoggedIn()).toBe(false);
    expect(service.user()).toBeNull();
  });

  it('asks with the session cookie and keeps the logged-in user', () => {
    service.checkAuth().subscribe();
    const req = http.expectOne(`${API}/auth/me`);
    expect(req.request.withCredentials).toBe(true);
    req.flush({
      loggedIn: true,
      id: 'u1',
      email: 'a@b.hu',
      name: 'Bodri',
      role: 'admin',
      canManageRoles: true,
      familyId: 'f1',
      photoUpdatedAt: '2026-01-01',
    });

    expect(service.isLoggedIn()).toBe(true);
    expect(service.user()).toEqual({
      id: 'u1',
      email: 'a@b.hu',
      name: 'Bodri',
      role: 'admin',
      canManageRoles: true,
      familyId: 'f1',
      wantsEmailNotifications: true,
      address: undefined,
      photoUpdatedAt: '2026-01-01',
    });
  });

  it('fills the defaults: guest role, e-mails on, no photo, no role management', () => {
    answerMe({ loggedIn: true, id: 'u1' });
    expect(service.user()).toMatchObject({
      role: 'guest',
      canManageRoles: false,
      wantsEmailNotifications: true,
      photoUpdatedAt: null,
    });
  });

  it('keeps an explicit "no e-mails"', () => {
    answerMe({ loggedIn: true, id: 'u1', wantsEmailNotifications: false });
    expect(service.user()?.wantsEmailNotifications).toBe(false);
  });

  it('has no user when the server says logged out', () => {
    answerMe({ loggedIn: true, id: 'u1' });
    answerMe({ loggedIn: false });
    expect(service.isLoggedIn()).toBe(false);
    expect(service.user()).toBeNull();
  });

  it('counts a failed request as logged out, without an error for the caller', () => {
    answerMe({ loggedIn: true, id: 'u1' });
    let result: unknown;
    service.checkAuth().subscribe((res) => (result = res));
    http.expectOne(`${API}/auth/me`).flush('', { status: 500, statusText: 'Error' });
    expect(result).toEqual({ loggedIn: false });
    expect(service.isLoggedIn()).toBe(false);
    expect(service.user()).toBeNull();
  });

  it('asks which login the server runs with - the provider when it cannot be asked', () => {
    let mode: unknown;
    service.loginMode().subscribe((res) => (mode = res));
    http.expectOne(`${API}/auth/mode`).flush({ localLogin: true });
    expect(mode).toEqual({ localLogin: true });

    service.loginMode().subscribe((res) => (mode = res));
    http.expectOne(`${API}/auth/mode`).flush('', { status: 500, statusText: 'Error' });
    expect(mode).toEqual({ localLogin: false });
  });

  it('logs in with e-mail and password, taking the session cookie', () => {
    service.localLogin('a@b.hu', 'jelszo').subscribe();
    const req = http.expectOne(`${API}/auth/local-login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.hu', password: 'jelszo' });
    expect(req.request.withCredentials).toBe(true);
    req.flush({ status: 'success' });
  });

  it('knows for how long sensitive operations go without identifying again', () => {
    expect(service.hasFreshLogin()).toBe(false);
    answerMe({ loggedIn: true, id: 'u1', role: 'admin' }); // logged in long ago
    expect(service.hasFreshLogin()).toBe(false);

    vi.useFakeTimers();
    try {
      answerMe({ loggedIn: true, id: 'u1', role: 'admin', freshLoginSecondsLeft: 120 });
      expect(service.hasFreshLogin()).toBe(true);
      vi.advanceTimersByTime(119_000);
      expect(service.hasFreshLogin()).toBe(true);
      vi.advanceTimersByTime(2_000);
      expect(service.hasFreshLogin()).toBe(false);

      // Nothing of it is left after a logout, or once the server refused one.
      answerMe({ loggedIn: true, id: 'u1', role: 'admin', freshLoginSecondsLeft: 120 });
      answerMe({ loggedIn: false });
      expect(service.hasFreshLogin()).toBe(false);
      answerMe({ loggedIn: true, id: 'u1', role: 'admin', freshLoginSecondsLeft: 120 });
      service.freshLoginGone();
      expect(service.hasFreshLogin()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('patches the current user, but only when there is one', () => {
    service.patchCurrentUser({ name: 'Senki' });
    expect(service.user()).toBeNull();

    answerMe({ loggedIn: true, id: 'u1', name: 'Bodri', role: 'member' });
    service.patchCurrentUser({ name: 'Új név' });
    expect(service.user()).toMatchObject({ id: 'u1', name: 'Új név', role: 'member' });
  });
});
