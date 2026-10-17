import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { API } from '../../../testing/http';
import { NotificationsService } from '../../notifications/notifications.service';
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.restoreAllMocks());

  it('is the emergency login only: otherwise - or if the server cannot be asked - on to the landing page', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    open(false);
    expect(navigate).toHaveBeenLastCalledWith('/', { replaceUrl: true });
    expect(fixture.nativeElement.querySelector('form')).toBeNull();

    navigate.mockClear();
    open('error');
    expect(component.mode()).toBe('oidc');
    expect(navigate).toHaveBeenCalledWith('/', { replaceUrl: true });

    navigate.mockClear();
    open(true);
    expect(navigate).not.toHaveBeenCalled();
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
});
