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
import { FutokorCourse } from '../../../../services/futokor';

// A numbered pin for a checkpoint - "R" in orange for the START/FINISH.
function pin(text: string, start: boolean, lit: boolean): L.DivIcon {
  const classes = ['futokor-pin', start && 'futokor-pin--start', lit && 'futokor-pin--lit']
    .filter(Boolean)
    .join(' ');
  return L.divIcon({
    className: '',
    html: `<span class="${classes}">${text}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Someone on the course right now.
export interface MapRunner {
  name: string;
  lat: number;
  lng: number;
  me?: boolean;
}

// A runner's dot: their initial - mine stands out.
function runnerDot(runner: MapRunner): L.DivIcon {
  const initial = (runner.name.trim()[0] ?? '?').toUpperCase();
  return L.divIcon({
    className: '',
    html: `<span class="futokor-runner${runner.me ? ' futokor-runner--me' : ''}">${initial}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// A phone among trees is off by a few metres: a runner within this much of
// the loop is shown on it.
const SNAP_M = 30;

// The point of the track nearest to a place - the place itself if the
// track is further than SNAP_M (or there's none).
function onTrack(track: L.LatLngTuple[], lat: number, lng: number): L.LatLngTuple {
  // Metres on a flat sheet around the place: fine at this size.
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best: L.LatLngTuple = [lat, lng];
  let bestD = SNAP_M;
  for (let i = 1; i < track.length; i += 1) {
    const [ax, ay] = [(track[i - 1][1] - lng) * kx, (track[i - 1][0] - lat) * ky];
    const [bx, by] = [(track[i][1] - lng) * kx, (track[i][0] - lat) * ky];
    const [dx, dy] = [bx - ax, by - ay];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const [px, py] = [ax + t * dx, ay + t * dy];
    const d = Math.hypot(px, py);
    if (d < bestD) {
      bestD = d;
      best = [lat + py / ky, lng + px / kx];
    }
  }
  return best;
}

// A course on the map: the loop (from its GPX track) and its cards - the
// START/FINISH and the numbered checkpoints, each where it hangs. Without
// a connection the map's own pictures don't load: the loop and the points
// are drawn all the same, on a plain background.
//
// `runners`: who is on the course right now and lets it be seen - a dot
// each, with their name.
//
// When `editable` (the Pályaszerkesztő), the points can be put in place: a
// tap on the map says where (`picked`), and a point can be dragged
// (`moved`). `lit` is the point being placed.
@Component({
  selector: 'app-course-map',
  template: `<div class="map" [class.editable]="editable()" #map></div>`,
  styleUrl: './course-map.scss',
})
export class CourseMap implements OnDestroy {
  course = input.required<FutokorCourse>();
  editable = input(false);
  // The order of the point being placed - none: null.
  lit = input<number | null>(null);
  runners = input<MapRunner[]>([]);
  picked = output<{ lat: number; lng: number }>();
  moved = output<{ order: number; lat: number; lng: number }>();

  private container = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private drawn: L.FeatureGroup | null = null;
  private runnerDots: L.LayerGroup | null = null;
  // What the map was last fitted to: it only moves when the loop changes,
  // not every time a point does.
  private fittedTo = '';

  constructor() {
    // (After the render: the container must be on the page before Leaflet
    // touches it - see components/tours-map.)
    afterRenderEffect(() => this.draw(this.course(), this.editable(), this.lit()));
    // (On their own layer: they move every few seconds, the rest stays.)
    afterRenderEffect(() => this.drawRunners(this.course(), this.runners()));
  }

  private drawRunners(course: FutokorCourse, runners: MapRunner[]) {
    this.runnerDots?.remove();
    this.runnerDots = null;
    if (!this.map || !runners.length) return;
    const track = (course.track ?? []) as L.LatLngTuple[];
    this.runnerDots = L.layerGroup(
      runners.map((r) =>
        L.marker(onTrack(track, r.lat, r.lng), {
          icon: runnerDot(r),
          zIndexOffset: r.me ? 3000 : 2000,
          interactive: false,
        }).bindTooltip(r.name, {
          permanent: true,
          direction: 'top',
          offset: [0, -14],
          className: 'futokor-runner-name',
        }),
      ),
    ).addTo(this.map);
  }

  private draw(course: FutokorCourse, editable: boolean, lit: number | null) {
    if (!this.map) {
      this.map = L.map(this.container().nativeElement, { scrollWheelZoom: false });
      // Leaflet's own prefix (see components/tours-map).
      this.map.attributionControl.setPrefix(false);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(this.map);
      this.map.on('click', (e: L.LeafletMouseEvent) => {
        if (this.editable()) this.picked.emit({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    }
    this.drawn?.remove();

    const layers: L.Layer[] = [];
    const track = (course.track ?? []) as L.LatLngTuple[];
    if (track.length > 1) {
      // A white edge under the line, so it reads on any map. (The lines
      // let a tap through to the map: a point is put right on the loop.)
      layers.push(
        L.polyline(track, { color: '#fff', weight: 8, opacity: 0.9, interactive: false }),
      );
      layers.push(L.polyline(track, { color: '#f07827', weight: 4.5, interactive: false }));
    }
    for (const c of course.checkpoints) {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
      const start = c.kind === 'startFinish';
      const along = !start && c.distanceAlongM ? ` · ${c.distanceAlongM} m` : '';
      const marker = L.marker([c.lat, c.lng], {
        icon: pin(start ? 'R' : String(c.order), start, c.order === lit),
        // The START/FINISH on top where a checkpoint is right beside it.
        zIndexOffset: start ? 1000 : 0,
        draggable: editable && !start,
      }).bindTooltip(`${c.label}${along}`);
      marker.on('dragend', () => {
        const at = marker.getLatLng();
        this.moved.emit({ order: c.order, lat: at.lat, lng: at.lng });
      });
      layers.push(marker);
    }
    if (!layers.length) return;
    this.drawn = L.featureGroup(layers).addTo(this.map);

    const key = `${course._id}:${track.length}:${track[0]?.join()}`;
    if (key !== this.fittedTo) {
      this.fittedTo = key;
      this.map.fitBounds(this.drawn.getBounds(), { padding: [24, 24] });
    }
  }

  ngOnDestroy() {
    this.map?.remove();
  }
}
