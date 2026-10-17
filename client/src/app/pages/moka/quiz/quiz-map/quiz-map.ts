import {
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  input,
  output,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { lazyStyleReady } from '../../../../shared/lazy-style';
import { QuizBounds, QuizPlace } from '../../../../services/quiz';

// Someone's pin, shown once the question is closed.
export interface MapGuess extends QuizPlace {
  name: string;
  me?: boolean;
}

function marker(kind: 'pin' | 'place' | 'guess', text = ''): L.DivIcon {
  const size = kind === 'guess' ? 22 : 34;
  return L.divIcon({
    className: '',
    html: `<span class="quiz-mark quiz-mark--${kind}"><i>${text}</i></span>`,
    iconSize: [size, size],
    // The pin and the place stand on their point; a guess is a dot on it.
    iconAnchor: kind === 'guess' ? [size / 2, size / 2] : [size / 2, size],
  });
}

const key = (b: QuizBounds) => [b.south, b.west, b.north, b.east].join(',');
const latLngBounds = (b: QuizBounds): L.LatLngBoundsLiteral => [
  [b.south, b.west],
  [b.north, b.east],
];

// What there is a drawing of: Hungary with all its neighbours whole (the
// same box as in server/scripts/buildQuizMap.mjs).
const DRAWN: QuizBounds = { south: 41.8, west: 9.0, north: 52.8, east: 40.6 };
// Hungary, its borders: in the game a player may always back away far
// enough to see all of it.
const HUNGARY: QuizBounds = { south: 45.74, west: 16.11, north: 48.59, east: 22.9 };

// The app's own drawing of it: the countries, the rivers (the big ones and
// the smaller ones) and the lakes, as GeoJSON - made from Natural Earth's
// public-domain data by server/scripts/buildQuizMap.mjs and shipped with
// the app. Fetched once, when a map is first shown.
interface Drawing {
  land: unknown[];
  lakes: unknown;
  rivers: unknown;
  streams: unknown;
}
// The map's own layer for the drawing (under Leaflet's layer of marks).
const BASE = 'quiz-base';
let loading: Promise<Drawing | null> | null = null;
const drawing = () =>
  (loading ??= Promise.resolve()
    .then(() => fetch('assets/maps/quiz-map.json'))
    .then((res) => (res.ok ? (res.json() as Promise<Drawing>) : null))
    .catch(() => null));

// In a game: how many times closer than the chosen picture a player may
// look at the map.
const GAME_ZOOM = 2;

// Móka → Kvíz: a map question's map - Leaflet showing the app's own drawing
// of Hungary and its neighbours (where the tours are): borders, rivers and lakes,
// and no names at all - they'd give the answer away. No map provider is
// asked for anything.
// - In the game it's `locked`: it opens on exactly the part its author
//   chose, on every screen - a player can look closer at it (up to
//   GAME_ZOOM times), back away until all of Hungary is in sight, and move
//   about over all there is a drawing of. While the question is open a tap puts
//   my pin down, or moves it (`pickable`, `picked`); once it's closed the
//   place itself and everyone's pins are on it (`place`, `guesses`).
// - In the editor it isn't: the author moves and zooms it to the part the
//   players should see (`boundsChanged`) and taps the place (`picked`).
@Component({
  selector: 'app-quiz-map',
  template: `<div class="map" [class.pickable]="pickable()" #map></div>`,
  styleUrl: './quiz-map.scss',
})
export class QuizMap implements OnDestroy {
  bounds = input.required<QuizBounds>();
  locked = input(true);
  pickable = input(false);
  // My pin - in the editor: the place.
  pin = input<QuizPlace | null>(null);
  // The right place, once it may be shown.
  place = input<QuizPlace | null>(null);
  guesses = input<MapGuess[]>([]);
  picked = output<QuizPlace>();
  boundsChanged = output<QuizBounds>();

  private container = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private drawn: L.LayerGroup | null = null;
  // What the map was last fitted to - and, in the editor, what it last
  // said it shows: only a change from outside moves it.
  private shown = '';
  private fitting = false;
  // Watches the map's own box: Leaflet draws for the size it was last told.
  private sizeWatch: ResizeObserver | null = null;
  private hasSize = false;

  private styled = lazyStyleReady('leaflet');

  constructor() {
    // (After the render: the container must be on the page before Leaflet
    // touches it - see components/tours-map.)
    // And Leaflet's stylesheet must be in: it comes with the map
    // (shared/lazy-style).
    afterRenderEffect(() => {
      if (this.styled()) this.draw(this.bounds(), this.pin(), this.place(), this.guesses());
    });
  }

  ngOnDestroy() {
    this.sizeWatch?.disconnect();
    this.map?.remove();
  }

  // The map's box changed: it came into view (the editor's preview on a
  // phone is made while still hidden - with no size at all), the phone was
  // turned, the window resized. In a game the chosen part is fitted again;
  // in the editor the view stays, only redrawn for the new size - unless
  // it had no size before, then it's fitted for the first time.
  private resized() {
    const box = this.container().nativeElement;
    if (!this.map || !box.offsetWidth || !box.offsetHeight) return;
    if (this.locked() || !this.hasSize) {
      this.fit(this.bounds());
    } else {
      this.fitting = true;
      this.map.invalidateSize();
      this.fitting = false;
    }
    this.hasSize = true;
  }

  private create() {
    const locked = this.locked();
    const map = L.map(this.container().nativeElement, {
      // In the game the picture opens the same for everyone - a player
      // zooms (two fingers, or the mouse's wheel) and moves about: fit()
      // sets how far, and where the edges are. No double-tap zoom: a second tap moves the pin.
      doubleClickZoom: !locked,
      boxZoom: !locked,
      keyboard: !locked,
      zoomControl: !locked,
      // Any zoom in between, so the chosen part fits exactly.
      zoomSnap: locked ? 0 : 1,
      ...(locked && { maxBoundsViscosity: 1, bounceAtZoomLimits: false }),
      // The editor stays on what there is a drawing of, and no closer than
      // the drawing is good for.
      ...(!locked && {
        maxBounds: latLngBounds(DRAWN),
        maxBoundsViscosity: 1,
        minZoom: 4,
        maxZoom: 11,
      }),
    });
    // Leaflet's own prefix (see components/tours-map).
    map.attributionControl.setPrefix(false);
    void drawing().then((data) => {
      // (Gone meanwhile, or the file didn't arrive: the pins still work,
      // on the plain background.)
      if (!data || this.map !== map) return;
      // A layer of its own under the pins and their lines: within it the
      // sea, the land, then what is drawn over it - the streams, the
      // rivers, the lakes.
      map.createPane(BASE).style.zIndex = '300';
      const still = { interactive: false, pane: BASE };
      const layers = [
        // The sea: where the drawing has no land. (Beyond the drawing the
        // map's own background shows - the land's colour.)
        L.rectangle(latLngBounds(DRAWN), {
          ...still,
          stroke: false,
          fillColor: '#cfe6f2',
          fillOpacity: 1,
        }),
        L.geoJSON(data.land as never, {
          ...still,
          style: { color: '#8f8264', weight: 1.5, fillColor: '#f3ecd6', fillOpacity: 1 },
          attribution: 'Natural Earth',
        }),
        L.geoJSON(data.streams as never, { ...still, style: { color: '#6fabd3', weight: 0.75 } }),
        L.geoJSON(data.rivers as never, { ...still, style: { color: '#3d8ec4', weight: 1.5 } }),
        L.geoJSON(data.lakes as never, {
          ...still,
          style: { color: '#3d8ec4', weight: 1, fillColor: '#9fd0ee', fillOpacity: 1 },
        }),
      ];
      for (const layer of layers) layer.addTo(map);
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.pickable()) this.picked.emit({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.sizeWatch = new ResizeObserver(() => this.resized());
      this.sizeWatch.observe(this.container().nativeElement);
    }
    if (!locked) {
      // The author moved or zoomed it: that's what the players will see.
      map.on('moveend', () => {
        if (this.fitting) return;
        const b = map.getBounds();
        const now = {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        };
        this.shown = key(now);
        this.boundsChanged.emit(now);
      });
    }
    return map;
  }

  private fit(bounds: QuizBounds) {
    if (!this.map) return;
    this.fitting = true;
    const locked = this.locked();
    if (locked) {
      // The last picture's limits would hold this one back.
      this.map.setMaxBounds(undefined as never);
      this.map.setMinZoom(0);
      this.map.setMaxZoom(Infinity);
    }
    this.map.invalidateSize();
    this.map.fitBounds(latLngBounds(bounds), { animate: false });
    if (locked) {
      // In the game: it starts on the part as it was chosen, but a player
      // may back away until all of Hungary is in sight (a close-up of a few
      // rivers says nothing on its own) and move about over all there is a
      // drawing of; no closer than GAME_ZOOM times the chosen part.
      const fitted = this.map.getZoom();
      const wholeCountry = this.map.getBoundsZoom(latLngBounds(HUNGARY), false);
      this.map.setMinZoom(Math.min(fitted, wholeCountry));
      this.map.setMaxZoom(fitted + Math.log2(GAME_ZOOM));
      this.map.setMaxBounds(latLngBounds(DRAWN));
    }
    this.fitting = false;
    this.shown = key(bounds);
  }

  private draw(
    bounds: QuizBounds,
    pin: QuizPlace | null,
    place: QuizPlace | null,
    guesses: MapGuess[],
  ) {
    this.map ??= this.create();
    if (key(bounds) !== this.shown) this.fit(bounds);

    this.drawn?.remove();
    const layers: L.Layer[] = [];
    for (const g of guesses) {
      // How far off it was: a line to the place.
      if (place) {
        layers.push(
          L.polyline([g, place], {
            color: g.me ? '#f07827' : '#23354a',
            weight: g.me ? 2.5 : 1.5,
            opacity: 0.7,
            dashArray: '4 5',
            interactive: false,
          }),
        );
      }
      layers.push(
        L.marker(g, {
          icon: marker('guess', (g.name.trim()[0] ?? '?').toUpperCase()),
          zIndexOffset: g.me ? 500 : 0,
          interactive: false,
        }).bindTooltip(g.name, {
          permanent: true,
          direction: 'top',
          offset: [0, -10],
          className: 'quiz-mark-name',
        }),
      );
    }
    if (pin)
      layers.push(L.marker(pin, { icon: marker('pin'), zIndexOffset: 1000, interactive: false }));
    if (place) {
      layers.push(
        L.marker(place, { icon: marker('place', '★'), zIndexOffset: 2000, interactive: false }),
      );
    }
    this.drawn = L.layerGroup(layers).addTo(this.map);
  }
}
