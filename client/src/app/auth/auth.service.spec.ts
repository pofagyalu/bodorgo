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

  it('patches the current user, but only when there is one', () => {
    service.patchCurrentUser({ name: 'Senki' });
    expect(service.user()).toBeNull();

    answerMe({ loggedIn: true, id: 'u1', name: 'Bodri', role: 'member' });
    service.patchCurrentUser({ name: 'Új név' });
    expect(service.user()).toMatchObject({ id: 'u1', name: 'Új név', role: 'member' });
  });
});
