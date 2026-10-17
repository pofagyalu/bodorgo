import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { pageTesting } from '../../../testing/component';
import { NotificationsService } from '../../notifications/notifications.service';
import { Home } from './home';

// A refused login comes back to the landing page with ?error=... (server
// authOidcController.js's callback): it says why, once.
describe('Home: back from a refused login', () => {
  function open(query: Record<string, string>) {
    TestBed.configureTestingModule({
      providers: [
        pageTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
      ],
    });
    // Only what Home itself does - not the landing page or homepage under it.
    TestBed.overrideComponent(Home, { set: { imports: [], template: '' } });
    const error = vi
      .spyOn(TestBed.inject(NotificationsService), 'addError')
      .mockImplementation(() => {});
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.createComponent(Home).detectChanges();
    return { error, navigate };
  }

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['not-invited', 'Még nem vagy felvéve'],
    ['unverified-email', 'nincs megerősítve'],
    ['suspended', 'fel van függesztve'],
  ])('%s: says why, and takes the error off the address', (code, text) => {
    const { error, navigate } = open({ error: code });
    expect(error).toHaveBeenCalledWith(expect.stringContaining(text));
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { error: null }, replaceUrl: true }),
    );
  });

  it('an ordinary visit says nothing; an unknown code is only taken off', () => {
    const quiet = open({});
    expect(quiet.error).not.toHaveBeenCalled();
    expect(quiet.navigate).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const unknown = open({ error: 'valami' });
    expect(unknown.error).not.toHaveBeenCalled();
    expect(unknown.navigate).toHaveBeenCalled();
  });
});
