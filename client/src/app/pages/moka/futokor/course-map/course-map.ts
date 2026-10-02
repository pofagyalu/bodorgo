import {
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  input,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { FutokorCourse } from '../../../../services/futokor';

// A numbered pin for a checkpoint - "R" in orange for the START/FINISH.
function pin(text: string, start: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span class="futokor-pin${start ? ' futokor-pin--start' : ''}">${text}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// A course on the map: the loop (from its GPX track) and its cards - the
// START/FINISH and the numbered checkpoints, each where it hangs. Without
// a connection the map's own pictures don't load: the loop and the points
// are drawn all the same, on a plain background.
@Component({
  selector: 'app-course-map',
  template: `<div class="map" #map></div>`,
  styleUrl: './course-map.scss',
})
export class CourseMap implements OnDestroy {
  course = input.required<FutokorCourse>();

  private container = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private drawn: L.FeatureGroup | null = null;

  constructor() {
    // (After the render: the container must be on the page before Leaflet
    // touches it - see components/tours-map.)
    afterRenderEffect(() => this.draw(this.course()));
  }

  private draw(course: FutokorCourse) {
    if (!this.map) {
      this.map = L.map(this.container().nativeElement, { scrollWheelZoom: false });
      // Leaflet's own prefix (see components/tours-map).
      this.map.attributionControl.setPrefix(false);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(this.map);
    }
    this.drawn?.remove();

    const layers: L.Layer[] = [];
    const track = (course.track ?? []) as L.LatLngTuple[];
    if (track.length > 1) {
      // A white edge under the line, so it reads on any map.
      layers.push(L.polyline(track, { color: '#fff', weight: 8, opacity: 0.9 }));
      layers.push(L.polyline(track, { color: '#f07827', weight: 4.5 }));
    }
    for (const c of course.checkpoints) {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
      const start = c.kind === 'startFinish';
      const along = !start && c.distanceAlongM ? ` · ${c.distanceAlongM} m` : '';
      layers.push(
        L.marker([c.lat, c.lng], {
          icon: pin(start ? 'R' : String(c.order), start),
          // The START/FINISH on top where a checkpoint is right beside it.
          zIndexOffset: start ? 1000 : 0,
        }).bindTooltip(`${c.label}${along}`),
      );
    }
    if (!layers.length) return;
    this.drawn = L.featureGroup(layers).addTo(this.map);
    this.map.fitBounds(this.drawn.getBounds(), { padding: [24, 24] });
  }

  ngOnDestroy() {
    this.map?.remove();
  }
}
