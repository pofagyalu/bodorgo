import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { HttpRequest, HttpResponse } from '@angular/common/http';
import { Router, RouterStateSnapshot } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { API, httpTesting } from '../../testing/http';
import { adminGuard } from './admin.guard';
import { authHttpInterceptor } from './auth-http-interceptor';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { canSeeFutokor, futokorAdminGuard } from './futokor.guard';
import { memberGuard } from './member.guard';
import { canSeeMoka, mokaGuard } from './moka.guard';
import { canEditSongs, songEditGuard } from './song-edit.guard';

type Me = { loggedIn: boolean; role?: string; canManageRoles?: boolean } | 'error';

describe('route guards', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  /** Runs a guard with the given answer to "who am I". */
  function run(guard: () => Observable<boolean>, me: Me): boolean | undefined {
    let allowed: boolean | undefined;
    TestBed.runInInjectionContext(guard).subscribe((v) => (allowed = v));
    const req = http.expectOne(`${API}/auth/me`);
    if (me === 'error') req.flush('', { status: 500, statusText: 'Error' });
    else req.flush({ id: 'u1', ...me });
    return allowed;
  }

  const state = (url: string) => ({ url }) as RouterStateSnapshot;
  const guest = { loggedIn: true, role: 'guest' };
  const member = { loggedIn: true, role: 'member' };
  const admin = { loggedIn: true, role: 'admin' };
  const owner = { loggedIn: true, role: 'admin', canManageRoles: true };
  const nobody = { loggedIn: false };

  beforeEach(() => {
    localStorage.clear();
    navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [httpTesting(), { provide: Router, useValue: { navigate } }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  describe('authGuard', () => {
    it('lets anyone logged in through', () => {
      expect(run(authGuard, guest)).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('sends a visitor to the front page', () => {
      expect(run(authGuard, nobody)).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/']);
    });
  });

  describe('memberGuard', () => {
    it.each([member, admin])('lets a member or an admin through', (me) => {
      expect(run(memberGuard, me)).toBe(true);
    });

    it.each([guest, nobody, 'error' as const])('turns everyone else back', (me) => {
      expect(run(memberGuard, me)).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/']);
    });
  });

  describe('adminGuard', () => {
    it('lets an admin through', () => {
      expect(run(adminGuard, admin)).toBe(true);
    });

    it.each([member, guest, nobody, 'error' as const])('sends others to the member list', (me) => {
      expect(run(adminGuard, me)).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/klub/felhasznalok']);
    });
  });

  describe('songEditGuard', () => {
    it('is for the role manager only', () => {
      expect(run(songEditGuard, owner)).toBe(true);
      expect(run(songEditGuard, admin)).toBe(false);
      expect(run(songEditGuard, 'error')).toBe(false);
      expect(navigate).toHaveBeenCalledTimes(2);
      expect(canEditSongs(null)).toBe(false);
    });
  });

  describe('futokorAdminGuard', () => {
    it('needs both the admin role and the role-manager right', () => {
      expect(run(futokorAdminGuard, owner)).toBe(true);
      expect(run(futokorAdminGuard, admin)).toBe(false);
      expect(run(futokorAdminGuard, { loggedIn: true, role: 'member', canManageRoles: true })).toBe(
        false,
      );
      expect(run(futokorAdminGuard, 'error')).toBe(false);
      expect(navigate).toHaveBeenCalledTimes(3);
      expect(canSeeFutokor(null)).toBe(false);
    });
  });

  describe('mokaGuard', () => {
    const moka = (url: string) => () => mokaGuard(null, state(url));

    it('is for the role manager', () => {
      expect(run(moka('/moka/darts'), owner)).toBe(true);
      expect(run(moka('/moka/darts'), member)).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/']);
      expect(canSeeMoka(null)).toBe(false);
    });

    it('also lets a phone with a downloaded race onto the race pages, logged in or not', () => {
      localStorage.setItem('futokor-course', '[]');
      expect(run(moka('/moka/futokor/fut'), nobody)).toBe(true);
      expect(run(moka('/moka/darts'), nobody)).toBe(false);
    });
  });

  // checkAuth() swallows HTTP errors itself; the guards' own catch is for
  // anything else going wrong in it.
  it.each([
    ['authGuard', authGuard, ['/']],
    ['memberGuard', memberGuard, ['/']],
    ['adminGuard', adminGuard, ['/klub/felhasznalok']],
    ['songEditGuard', songEditGuard, ['/']],
    ['futokorAdminGuard', futokorAdminGuard, ['/']],
    ['mokaGuard', () => mokaGuard(null, state('/moka')), ['/']],
  ] as [string, () => Observable<boolean>, string[]][])(
    '%s turns back when the check throws',
    (_name, guard, target) => {
      vi.spyOn(TestBed.inject(AuthService), 'checkAuth').mockReturnValue(
        throwError(() => new Error('x')),
      );
      let allowed: boolean | undefined;
      TestBed.runInInjectionContext(guard).subscribe((v) => (allowed = v));
      expect(allowed).toBe(false);
      expect(navigate).toHaveBeenCalledWith(target);
    },
  );
});

describe('authHttpInterceptor', () => {
  it('sends the session cookie with every request', () => {
    const next = vi.fn((_req: HttpRequest<unknown>) => of(new HttpResponse()));
    const req = new HttpRequest('GET', '/x');
    TestBed.runInInjectionContext(() => authHttpInterceptor(req, next));
    expect(next.mock.calls[0][0].withCredentials).toBe(true);
    expect(req.withCredentials).toBe(false); // the original is left alone
  });
});
