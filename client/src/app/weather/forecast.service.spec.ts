import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { httpTesting } from '../../testing/http';
import { NotificationsService } from '../notifications/notifications.service';
import { ForecastService } from './forecast.service';

describe('ForecastService', () => {
  let service: ForecastService;
  let http: HttpTestingController;
  let notifications: NotificationsService;
  const original = navigator.geolocation;

  /** The browser answers the position request this way. */
  function locate(answer: 'ok' | 'denied') {
    (navigator as { geolocation: unknown }).geolocation = {
      getCurrentPosition: (ok: (p: unknown) => void, fail: (e: unknown) => void) =>
        answer === 'ok'
          ? ok({ coords: { latitude: 47.5, longitude: 19.04 } })
          : fail(new Error('denied')),
    };
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(ForecastService);
    http = TestBed.inject(HttpTestingController);
    notifications = TestBed.inject(NotificationsService);
  });

  afterEach(() => {
    (navigator as { geolocation: unknown }).geolocation = original;
    vi.restoreAllMocks();
    http.verify();
  });

  it('asks for the forecast of where the user is, and keeps the 15:00 readings', () => {
    locate('ok');
    const success = vi.spyOn(notifications, 'addSuccess');
    let days: unknown;
    service.getForecast().subscribe((d) => (days = d));

    const req = http.expectOne((r) => r.url.includes('openweathermap.org'));
    expect(req.request.params.get('lat')).toBe('47.5');
    expect(req.request.params.get('lon')).toBe('19.04');
    expect(req.request.params.get('units')).toBe('metric');
    const reading = (time: string, temp: number) => ({
      dt_txt: time,
      main: { temp },
      weather: [{ main: 'Clouds', icon: '03d' }],
    });
    req.flush({
      list: [
        reading('2026-06-01 12:00:00', 20),
        reading('2026-06-01 15:00:00', 24),
        reading('2026-06-02 15:00:00', 26),
      ],
    });

    expect(days).toEqual([
      { dateString: '2026-06-01 15:00:00', temp: 24, weather: 'Clouds', icon: '03d' },
      { dateString: '2026-06-02 15:00:00', temp: 26, weather: 'Clouds', icon: '03d' },
    ]);
    expect(success).toHaveBeenCalledWith('Sikerült a helymeghatározás!');
  });

  it('gives no forecast, only a message, when the position is not available', () => {
    locate('denied');
    const error = vi.spyOn(notifications, 'addError');
    let completed = false;
    service.getForecast().subscribe({ complete: () => (completed = true) });
    expect(error).toHaveBeenCalledWith('Nem sikerült a helymeghatározás!');
    expect(completed).toBe(true);
  });
});
