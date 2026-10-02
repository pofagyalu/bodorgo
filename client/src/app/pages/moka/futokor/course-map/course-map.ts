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

// A course on the map: the loop (from its GPX track) and its cards - the
// START/FINISH and the numbered checkpoints, each where it hangs. Without
// a connection the map's own pictures don't load: the loop and the points
// are drawn all the same, on a plain background.
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
  picked = output<{ lat: number; lng: number }>();
  moved = output<{ order: number; lat: number; lng: number }>();

  private container = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private drawn: L.FeatureGroup | null = null;
  // What the map was last fitted to: it only moves when the loop changes,
  // not every time a point does.
  private fittedTo = '';

  constructor() {
    // (After the render: the container must be on the page before Leaflet
    // touches it - see components/tours-map.)
    afterRenderEffect(() => this.draw(this.course(), this.editable(), this.lit()));
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
