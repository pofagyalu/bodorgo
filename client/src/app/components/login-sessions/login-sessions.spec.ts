import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { fail, logIn, pageTesting, respond } from '../../../testing/component';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LoginSessions } from './login-sessions';

describe('LoginSessions (Profilom → Bejelentkezések)', () => {
  let fixture: ComponentFixture<LoginSessions>;

  // user: someone else's (their edit page) - else mine.
  function open(reply: object, user?: { _id: string; name: string }) {
    TestBed.configureTestingModule({ imports: [LoginSessions], providers: [pageTesting()] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logIn({ id: 'me', role: 'admin', canManageRoles: true });
    fixture = TestBed.createComponent(LoginSessions);
    if (user) fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    respond({ [user ? `GET /users/${user._id}/sessions` : 'GET /auth/sessions']: reply });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => vi.restoreAllMocks());

  it('lists my app sessions with this one marked, and the devices Authentik remembers', () => {
    const el = open({
      data: {
        here: { device: 'Chrome · Android', ip: '130.43.212.91' },
        app: [
          {
            id: 's1',
            current: true,
            device: 'Chrome · Android',
            ip: '130.43.212.91',
            loginAt: '2026-10-15T16:08:00Z',
            lastActiveAt: '2026-10-15T16:08:00Z',
            expiresAt: '2027-01-13T16:08:00Z',
          },
          {
            id: 's2',
            current: false,
            device: null,
            ip: null,
            loginAt: null,
            lastActiveAt: '2026-10-02T10:00:00Z',
            expiresAt: '2026-12-31T10:00:00Z',
          },
        ],
        authentik: [
          {
            id: 'a1',
            device: 'Firefox · Windows',
            ip: '192.168.1.33',
            lastUsedAt: '2026-10-09T08:00:00Z',
            expiresAt: '2026-12-28T20:18:28Z',
            count: 3,
          },
        ],
        authentikError: null,
      },
    });
    const rows = [...el.querySelectorAll('.session-row')].map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Chrome · Android');
    expect(rows[0]).toContain('Ez az eszköz');
    expect(rows[1]).toContain('Firefox · Windows');
    expect(rows[1]).toContain('3×');
    // The one from before devices were saved: only counted.
    expect(el.querySelector('.session-more')?.textContent).toContain(
      '+ 1 régebbi bejelentkezés, eszköz nem ismert',
    );
    expect(el.querySelector('.session-here')?.textContent).toContain('130.43.212.91');
  });

  it('says when Authentik could not be asked, and when nothing loaded', () => {
    let el = open({
      data: {
        here: { device: null, ip: '::1' },
        app: [],
        authentik: null,
        authentikError: 'Az Oridzsinátor most nem válaszol.',
      },
    });
    expect(el.textContent).toContain('Az Oridzsinátor most nem válaszol.');

    TestBed.resetTestingModule();
    el = open(fail());
    expect(el.textContent).toContain('A bejelentkezések betöltése nem sikerült.');
  });

  it('logs out the other devices after a yes, says how it went and loads the list again', async () => {
    const empty = {
      data: { here: { device: null, ip: '::1' }, app: [], authentik: [], authentikError: null },
    };
    const el = open(empty);
    const confirm = TestBed.inject(ConfirmService);
    const notifications = TestBed.inject(NotificationsService);
    const success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
    const error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});

    const ask = vi.spyOn(confirm, 'ask').mockResolvedValueOnce(false);
    (el.querySelector('.logout-others') as HTMLButtonElement).click();
    await ask.mock.results[0].value;
    respond({ 'POST /auth/sessions/logout-others': { data: { appEnded: 0, authentikEnded: 0 } } });
    expect(success).not.toHaveBeenCalled();

    ask.mockResolvedValueOnce(true);
    await fixture.componentInstance.logOut();
    // While it runs: the spinner and the "please wait".
    fixture.detectChanges();
    expect(el.querySelector('.logout-others app-loading-spinner')).toBeTruthy();
    expect(el.querySelector('.busy-note')?.textContent).toContain('kérlek, várj');
    respond({
      'POST /auth/sessions/logout-others': { data: { appEnded: 2, authentikEnded: 5 } },
      'GET /auth/sessions': empty,
    });
    expect(success).toHaveBeenCalledWith('Minden más eszközödön kijelentkeztél.');

    ask.mockResolvedValueOnce(true);
    await fixture.componentInstance.logOut();
    respond({
      'POST /auth/sessions/logout-others': { data: { appEnded: 0, authentikEnded: null } },
      'GET /auth/sessions': empty,
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('az Oridzsinátor most nem válaszolt'),
    );
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('someone else’s: their devices, and after a yes and identifying, out of everywhere', async () => {
    const kata = { _id: 'u1', name: 'Teszt Kata' };
    const theirs = {
      data: {
        app: [
          {
            id: 's1',
            current: false,
            device: 'Safari · iPhone',
            ip: '10.20.30.21',
            loginAt: '2026-10-15T16:08:00Z',
            lastActiveAt: '2026-10-15T16:08:00Z',
            expiresAt: '2027-01-13T16:08:00Z',
          },
        ],
        authentik: [],
        authentikError: null,
      },
    };
    const el = open(theirs, kata);
    expect(el.querySelector('.subtext')?.textContent).toContain(
      'Teszt Kata ezeken az eszközökön van bejelentkezve.',
    );
    expect(el.textContent).toContain('Safari · iPhone');
    expect(el.querySelector('.session-here')).toBeNull();
    expect(el.querySelector('.logout-others')?.textContent).toContain(
      'Kijelentkeztetés mindenhonnan',
    );

    const success = vi
      .spyOn(TestBed.inject(NotificationsService), 'addSuccess')
      .mockImplementation(() => {});
    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    await fixture.componentInstance.logOut();
    respond({
      'POST /users/u1/logout-everywhere': { data: { appEnded: 1, authentikEnded: 2 } },
      'GET /users/u1/sessions': theirs,
    });
    expect(success).toHaveBeenCalledWith('Teszt Kata minden eszközén kijelentkezett.');
  });
});
