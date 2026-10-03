import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { TourTicker } from './tour-ticker';

describe('TourTicker', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [TourTicker],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(TourTicker);
    fixture.detectChanges();
    const request = TestBed.inject(HttpTestingController).expectOne((req) =>
      req.url.endsWith('/ticker'),
    );
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, request, el };
  }

  it('keeps the bar in place, empty, while its line is on the way', () => {
    const { el } = setup();
    expect(el.querySelector('.ticker')).toBeTruthy();
    expect(el.querySelector('.ticker-track')).toBeNull();
  });

  it('fills the bar when the tour arrives', () => {
    const { fixture, request, el } = setup();
    request.flush({
      status: 'success',
      data: {
        label: 'Következő',
        order: 42,
        title: 'Mátra',
        place: 'Mátraháza',
        startDate: '2026-10-20T00:00:00.000Z',
      },
    });
    fixture.detectChanges();
    expect(el.querySelector('.ticker-item')?.textContent).toContain('Mátra');
  });

  it('takes the bar away when there is no tour to tell about', () => {
    const { fixture, request, el } = setup();
    request.flush({ status: 'success', data: null });
    fixture.detectChanges();
    expect(el.querySelector('.ticker')).toBeNull();
  });

  it('takes the bar away when the answer fails', () => {
    const { fixture, request, el } = setup();
    request.flush('', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(el.querySelector('.ticker')).toBeNull();
  });
});
