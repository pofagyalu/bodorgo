import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as L from 'leaflet';

import { lazyStyle } from '../../../../shared/lazy-style';
import { QuizMap } from './quiz-map';

// The map of a map question: what a player may do with it in a game.

const HUNGARY = { south: 45.7, west: 16.1, north: 48.6, east: 22.9 };
const BALATON = { south: 46.6, west: 17.2, north: 47.1, east: 18.2 };

describe('QuizMap', () => {
  let fixture: ComponentFixture<QuizMap>;

  // The map Leaflet made inside the component.
  const mapOf = () => (fixture.componentInstance as unknown as { map: L.Map }).map;

  function show(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(QuizMap);
    for (const [name, value] of Object.entries({ bounds: HUNGARY, ...inputs })) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    TestBed.tick();
    return mapOf();
  }

  beforeEach(async () => {
    // The map is drawn once Leaflet's stylesheet is in.
    await lazyStyle('leaflet');
    // The test browser lays nothing out: give the map's box a size (and no
    // drawing to fetch - the pins work on the plain background).
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false })),
    );
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lets a player look twice as close in a game, and back away until all of Hungary is in sight', () => {
    // A close-up the author chose (a few rivers say nothing on their own).
    const map = show({ bounds: BALATON });
    const fitted = map.getZoom();
    const wholeCountry = map.getBoundsZoom(
      [
        [45.74, 16.11],
        [48.59, 22.9],
      ],
      false,
    );
    expect(wholeCountry).toBeLessThan(fitted);
    expect(map.getMinZoom()).toBeCloseTo(wholeCountry);
    // One zoom level is twice the size.
    expect(map.getMaxZoom()).toBeCloseTo(fitted + 1);

    map.setZoom(fitted + 5, { animate: false });
    expect(map.getZoom()).toBeCloseTo(fitted + 1);
    map.setZoom(fitted - 10, { animate: false });
    expect(map.getZoom()).toBeCloseTo(wholeCountry);
  });

  it('a picture chosen wider than the country: no further out than that', () => {
    const map = show({ bounds: { south: 43, west: 13, north: 50, east: 26 } });
    expect(map.getMinZoom()).toBe(map.getZoom());
  });

  it('zooms with two fingers or the wheel, moves about - but a double tap is the pin`s', () => {
    const map = show();
    expect(map.touchZoom.enabled()).toBe(true);
    expect(map.scrollWheelZoom.enabled()).toBe(true);
    expect(map.dragging.enabled()).toBe(true);
    expect(map.doubleClickZoom.enabled()).toBe(false);
    expect(map.zoomControl).toBeUndefined();
  });

  it('opens on the picture that was chosen, and moves about over all of the drawing', () => {
    const map = show({ bounds: BALATON });
    expect(map.getBounds().contains([46.85, 17.7])).toBe(true);
    const edges = map.options.maxBounds as L.LatLngBounds;
    // Hungary and its neighbours whole - not only the chosen part.
    expect(edges.contains([47.5, 19.04])).toBe(true);
    expect(edges.contains([48.2, 16.37])).toBe(true); // Vienna
    expect(edges.contains([60, 19])).toBe(false);
  });

  it('starts over with the next question`s picture', () => {
    const map = show();
    const first = map.getMinZoom();
    map.setZoom(first + 1, { animate: false });

    fixture.componentRef.setInput('bounds', BALATON);
    fixture.detectChanges();
    TestBed.tick();
    // A smaller part of the world: fitted closer, with its own limits.
    expect(map.getZoom()).toBeGreaterThan(first + 1);
    expect(map.getMinZoom()).toBeLessThan(map.getZoom());
    expect(map.getMaxZoom()).toBeCloseTo(map.getZoom() + 1);
    expect((map.options.maxBounds as L.LatLngBounds).contains([46.85, 17.7])).toBe(true);
  });

  it('gives the tapped place while the question is open', () => {
    const map = show({ pickable: true });
    const picked: { lat: number; lng: number }[] = [];
    fixture.componentInstance.picked.subscribe((place) => picked.push(place));
    map.fire('click', { latlng: { lat: 47.5, lng: 19.04 } });
    expect(picked).toEqual([{ lat: 47.5, lng: 19.04 }]);
  });

  it('leaves the editor`s map free to move and zoom as before', () => {
    const map = show({ locked: false });
    expect(map.getMinZoom()).toBe(4);
    expect(map.getMaxZoom()).toBe(11);
    expect(map.doubleClickZoom.enabled()).toBe(true);
    expect(map.zoomControl).toBeDefined();
  });
});
