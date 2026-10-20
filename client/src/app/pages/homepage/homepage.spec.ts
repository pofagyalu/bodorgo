import { ComponentFixture, TestBed } from '@angular/core/testing';

import { fail, pageTesting, respond } from '../../../testing/component';
import { HomePage } from './homepage';

// The map (and the footer) come only once Statisztikák and Népszerű are in,
// so they don't appear high up and then get pushed down.
describe('HomePage', () => {
  let fixture: ComponentFixture<HomePage>;
  let page: HomePage;
  const el = () => fixture.nativeElement as HTMLElement;
  const mapShown = () => !!el().querySelector('.map-section');

  const STATS = { data: { totalTours: 12, totalParticipants: 300, upcomingTours: 1 } };
  const NOTHING_POPULAR = {
    data: { days: 30, photo: null, video: null, tour: null, track: null, song: null },
  };

  async function open() {
    TestBed.configureTestingModule({ imports: [HomePage], providers: [pageTesting()] });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(HomePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('shows the statistics kept from last time at once, then the fresh ones', async () => {
    await open();
    expect(el().querySelector('app-loading')).not.toBeNull();
    respond({ 'GET /tours/tour-stats': STATS });
    fixture.detectChanges();
    expect(JSON.parse(localStorage.getItem('homepage-stats')!).totalTours).toBe(12);

    // The next visit: no spinner - last time's numbers, until the new ones.
    fixture.destroy();
    TestBed.resetTestingModule();
    await open();
    expect(page.statsLoaded()).toBe(true);
    expect(page.stats()!.totalTours).toBe(12);
    expect(el().querySelector('app-loading')).toBeNull();
    respond({ 'GET /tours/tour-stats': { data: { ...STATS.data, totalTours: 13 } } });
    fixture.detectChanges();
    expect(page.stats()!.totalTours).toBe(13);
  });

  it('shows the map only after the statistics and Népszerű', async () => {
    await open();
    expect(mapShown()).toBe(false);
    respond({ 'GET /tours/tour-stats': STATS });
    fixture.detectChanges();
    expect(page.statsLoaded()).toBe(true);
    expect(mapShown()).toBe(false);

    await fixture.whenStable();
    respond({ 'GET /views/popular': NOTHING_POPULAR });
    fixture.detectChanges();
    expect(page.belowReady()).toBe(true);
    expect(mapShown()).toBe(true);
    expect(el().querySelector('app-site-footer')).not.toBeNull();
  });

  it('shows the map after failed statistics too', async () => {
    await open();
    respond({ 'GET /tours/tour-stats': fail() });
    fixture.detectChanges();
    await fixture.whenStable();
    respond({ 'GET /views/popular': fail() });
    fixture.detectChanges();
    expect(mapShown()).toBe(true);
  });

  it('does not wait for a slow Népszerű for ever', async () => {
    vi.useFakeTimers();
    await open();
    respond({ 'GET /tours/tour-stats': STATS });
    fixture.detectChanges();
    expect(mapShown()).toBe(false);
    vi.advanceTimersByTime(4000);
    fixture.detectChanges();
    expect(mapShown()).toBe(true);
  });
});
