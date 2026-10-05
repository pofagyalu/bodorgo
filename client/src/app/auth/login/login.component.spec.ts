import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { API } from '../../../testing/http';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuthService } from '../auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let http: HttpTestingController;

  // Opens the page with the server answering which login it runs with.
  function open(localLogin: boolean | 'error') {
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    const mode = http.expectOne(`${API}/auth/mode`);
    if (localLogin === 'error') mode.flush('', { status: 500, statusText: 'Error' });
    else mode.flush({ localLogin });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the way to the provider by default - also when the server cannot be asked', () => {
    open(false);
    expect(fixture.nativeElement.textContent).toContain('Gyere bé');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();

    open('error');
    expect(component.mode()).toBe('oidc');
  });

  it('with LOCAL_LOGIN on the server: an e-mail and password form instead', () => {
    open(true);
    expect(fixture.nativeElement.textContent).not.toContain('Gyere bé');
    const goHome = vi.spyOn(component, 'goHome').mockImplementation(() => {});

    component.logInWithPassword(); // nothing typed: nothing sent
    http.expectNone(`${API}/auth/local-login`);

    component.email.set(' gazda@klub.hu ');
    component.password.set('a-long-password');
    component.logInWithPassword();
    component.logInWithPassword(); // already on its way
    const req = http.expectOne(`${API}/auth/local-login`);
    expect(req.request.body).toEqual({ email: 'gazda@klub.hu', password: 'a-long-password' });
    expect(req.request.withCredentials).toBe(true);
    req.flush({ status: 'success' });
    expect(goHome).toHaveBeenCalled();
  });

  it('a refused login says why and empties the password', () => {
    open(true);
    const error = vi
      .spyOn(TestBed.inject(NotificationsService), 'addError')
      .mockImplementation(() => {});
    component.email.set('gazda@klub.hu');
    component.password.set('wrong');
    component.logInWithPassword();
    http
      .expectOne(`${API}/auth/local-login`)
      .flush({ message: 'Hibás e-mail cím vagy jelszó.' }, { status: 401, statusText: 'Error' });
    expect(error).toHaveBeenCalledWith('Hibás e-mail cím vagy jelszó.');
    expect(component.password()).toBe('');
    expect(component.loggingIn()).toBe(false);
  });

  it('says why a login was refused', () => {
    const error = vi
      .spyOn(TestBed.inject(NotificationsService), 'addError')
      .mockImplementation(() => {});
    const route = TestBed.inject(ActivatedRoute) as { snapshot: object };
    for (const [code, text] of [
      ['not-invited', 'Még nem vagy felvéve'],
      ['unverified-email', 'nincs megerősítve'],
    ]) {
      route.snapshot = { queryParamMap: convertToParamMap({ error: code }) };
      open(false);
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining(text));
    }
    route.snapshot = { queryParamMap: convertToParamMap({}) };
  });

  it('the button starts the login', () => {
    open(false);
    const login = vi.spyOn(TestBed.inject(AuthService), 'login').mockImplementation(() => {});
    fixture.nativeElement.querySelector('button').click();
    expect(login).toHaveBeenCalled();
  });
});
