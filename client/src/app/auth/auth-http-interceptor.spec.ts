import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { API } from '../../testing/http';
import { authHttpInterceptor } from './auth-http-interceptor';
import { AuthService } from './auth.service';

describe('authHttpInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authHttpInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    // Someone who identified themselves a moment ago.
    auth.checkAuth().subscribe();
    http
      .expectOne(`${API}/auth/me`)
      .flush({ loggedIn: true, id: 'me', freshLoginSecondsLeft: 600 });
  });

  afterEach(() => http.verify());

  const refuse = (status: number, body: object) => {
    let failed = false;
    client.post(`${API}/payments/withdraw`, {}).subscribe({ error: () => (failed = true) });
    const req = http.expectOne(`${API}/payments/withdraw`);
    expect(req.request.withCredentials).toBe(true);
    req.flush(body, { status, statusText: 'Error' });
    expect(failed).toBe(true); // the caller still gets the error
  };

  it('sends every request with the session cookie', () => {
    client.get(`${API}/tours`).subscribe();
    expect(http.expectOne(`${API}/tours`).request.withCredentials).toBe(true);
  });

  it('other refusals leave the fresh login alone', () => {
    refuse(403, { message: 'Nincs jogod.' });
    refuse(400, { code: 'fresh-login-required' });
    expect(auth.hasFreshLogin()).toBe(true);
  });

  it('a "identify again" refusal makes the next sensitive operation ask first', () => {
    refuse(403, { message: 'Ehhez újra azonosítanod kell magad.', code: 'fresh-login-required' });
    expect(auth.hasFreshLogin()).toBe(false);
  });
});
