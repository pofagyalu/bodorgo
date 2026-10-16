import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { logIn } from '../../testing/component';
import { PlayedTime, ViewTrackerService, secondsToCount } from './view-tracker';

describe('PlayedTime', () => {
  it('adds up only the small steps of playing - not a jump', () => {
    const played = new PlayedTime();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) played.update(t);
    played.update(40); // sought ahead
    played.update(40.5);
    played.update(10); // sought back
    played.update(10.25);
    expect(played.seconds).toBeCloseTo(1.75);
    played.reset();
    played.update(3);
    expect(played.seconds).toBe(0);
  });
});

describe('secondsToCount', () => {
  it('is 30 seconds - or half of a shorter one', () => {
    expect(secondsToCount(600)).toBe(30);
    expect(secondsToCount(40)).toBe(20);
    expect(secondsToCount(NaN)).toBe(30);
    expect(secondsToCount(Infinity)).toBe(30);
  });
});

describe('ViewTrackerService', () => {
  let views: ViewTrackerService;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    views = TestBed.inject(ViewTrackerService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends nothing for someone not logged in', () => {
    views.seen({ type: 'tour', key: 't1' });
    vi.advanceTimersByTime(60_000);
    http.expectNone(`${API}/views`);
  });

  it('sends what was seen a moment after the first one - each item once a day', () => {
    logIn({ role: 'member' });
    views.seen({ type: 'tour', key: 't1' });
    views.seen({ type: 'photo', key: 'tour:t1:IMG_1.jpg' });
    views.seen({ type: 'tour', key: 't1' });
    vi.advanceTimersByTime(900);
    http.expectNone(`${API}/views`);
    vi.advanceTimersByTime(100);
    const req = http.expectOne(`${API}/views`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      views: [
        { type: 'tour', key: 't1' },
        { type: 'photo', key: 'tour:t1:IMG_1.jpg' },
      ],
    });
    req.flush({ data: { recorded: 2 } });
    // Already sent today: not again.
    views.seen({ type: 'tour', key: 't1' });
    vi.advanceTimersByTime(60_000);
    http.expectNone(`${API}/views`);
  });

  it('sends at once, by sendBeacon, when the page is hidden', () => {
    logIn({ role: 'member' });
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    views.seen({ type: 'track', key: 'song1', playlist: 'bodorgo-fm' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe(`${API}/views`);
    expect(blob.type).toBe('text/plain');
    http.expectNone(`${API}/views`);
    // Nothing waiting any more.
    vi.advanceTimersByTime(60_000);
    http.expectNone(`${API}/views`);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('asks for the most viewed', () => {
    let answer: unknown;
    views.popular().subscribe((p) => (answer = p));
    http.expectOne(`${API}/views/popular`).flush({ data: { days: 30, photo: null } });
    expect(answer).toEqual({ days: 30, photo: null });
  });
});
