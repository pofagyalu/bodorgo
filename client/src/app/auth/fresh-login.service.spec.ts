import { TestBed } from '@angular/core/testing';

import { logIn, pageTesting } from '../../testing/component';
import { NotificationsService } from '../notifications/notifications.service';
import { FreshLoginService } from './fresh-login.service';

// Asking itself (ensure) is tried where it is used: the Barion card in
// pages/klub/settings/settings.spec.ts, the role list in people-pages.spec.ts.
describe('FreshLoginService: back from the provider', () => {
  const KEY = 'bodorgo.freshLoginAsked';
  let service: FreshLoginService;
  let success: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    service = TestBed.inject(FreshLoginService);
    const notifications = TestBed.inject(NotificationsService);
    success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
    error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
  });

  afterEach(() => {
    sessionStorage.removeItem(KEY);
    vi.restoreAllMocks();
  });

  it('says nothing on an ordinary start of the app', () => {
    logIn({ role: 'admin' });
    service.announceReturn();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('says it worked, once - the operation is theirs to start again', () => {
    sessionStorage.setItem(KEY, '1');
    logIn({ role: 'admin' });
    service.announceReturn();
    service.announceReturn();
    expect(success).toHaveBeenCalledTimes(1);
    expect(success.mock.calls[0][0]).toContain('Sikeres azonosítás');
  });

  it('says so when they came back without having identified themselves', () => {
    sessionStorage.setItem(KEY, '1');
    logIn({ role: 'admin', freshLoginSecondsLeft: 0 });
    service.announceReturn();
    expect(error).toHaveBeenCalledWith('Az azonosítás nem sikerült - a művelethez próbáld újra.');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
