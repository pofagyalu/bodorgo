import { Component, inject, signal, ElementRef, viewChild, afterRenderEffect } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import * as L from 'leaflet';
import { TourService, Tour } from '../../services/tour';

// Tours closer together than this count as the same place (one pin) -
// coordinates pasted for the same house are rarely exactly identical.
const SAME_PLACE_METERS = 100;

const SINGLE_PIN = { width: 26, height: 35 };
const GROUP_PIN = { width: 32, height: 43 };

// Newest first within each place. Compares against each group's first
// (newest) tour - Leaflet's distanceTo is the real on-the-globe distance
// in meters.
function groupByPlace(tours: Tour[]): Tour[][] {
  const groups: { at: L.LatLng; tours: Tour[] }[] = [];
  const located = tours
    .filter((t) => t.location?.coordinates?.[0] != null && t.location.coordinates[1] != null)
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  for (const tour of located) {
    const [lng, lat] = tour.location.coordinates;
    const at = L.latLng(lat, lng);
    const group = groups.find((g) => g.at.distanceTo(at) < SAME_PLACE_METERS);
    if (group) group.tours.push(tour);
    else groups.push({ at, tours: [tour] });
  }
  return groups.map((g) => g.tours);
}

// A plain circle has no inherent "point", so its visual center (not the
// anchored pixel) is what people read as the location - any mismatch there
// gets visually amplified when zoomed out. A pin shape with a sharp tip
// makes the anchor unambiguous: iconAnchor is set to that exact tip pixel.
//
// One single <path> so it always reads as one cohesive pin. A single tour
// gets the classic punched-out hole (a second circular subpath, rendered
// as a hole by fill-rule="evenodd"); a place with several tours gets a
// bigger pin with no hole and the count written in its head instead. The
// viewBox stays at the shape's own native 30x40 coordinate space, only
// the rendered width/height change.
function pinIcon(count: number): L.DivIcon {
  const size = count > 1 ? GROUP_PIN : SINGLE_PIN;
  const outline = 'M15 0C7.8 0 2 5.8 2 13c0 9.75 13 27 13 27s13-17.25 13-27C28 5.8 22.2 0 15 0z';
  const hole = ' M10 13a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z';
  const label =
    count > 1
      ? `<text class="tour-pin-count" x="15" y="13" text-anchor="middle" dominant-baseline="central">${count}</text>`
      : '';

  return L.divIcon({
    className: 'tour-marker',
    html: `
      <svg class="tour-pin" width="${size.width}" height="${size.height}" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path
          class="tour-pin-shape"
          fill-rule="evenodd"
          d="${count > 1 ? outline : outline + hole}"
          stroke="#fff"
          stroke-width="1.5"
        ></path>
        ${label}
      </svg>
    `,
    iconSize: [size.width, size.height],
    iconAnchor: [size.width / 2, size.height],
    popupAnchor: [0, 0],
  });
}

// Self-contained: fetches its own tour list, so it can be dropped anywhere
// (currently just the homepage) without the parent needing to fetch and
// wire up data for it.
@Component({
  selector: 'app-tours-map',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './tours-map.html',
  styleUrl: './tours-map.scss',
})
export class ToursMap {
  private tourService = inject(TourService);
  private router = inject(Router);

  private tours = signal<Tour[]>([]);
  isFullscreen = signal(false);

  private mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');
  private map: L.Map | null = null;

  constructor() {
    this.tourService.getTours().subscribe({
      next: (res) => this.tours.set(res.data.tours),
      error: (err) => console.error('Failed to load tours for map:', err),
    });

    // Waits for both the map container to exist in the DOM and the tours
    // to have loaded - afterRenderEffect (not a plain effect) guarantees
    // the container has actually been painted before Leaflet touches it
    // (same reasoning as the chat feature's auto-scroll fix).
    afterRenderEffect(() => {
      const container = this.mapContainer()?.nativeElement;
      const toursList = this.tours();
      if (container && toursList.length && !this.map) {
        this.initMap(container, toursList);
      }
    });
  }

  private initMap(container: HTMLDivElement, tours: Tour[]) {
    this.map = L.map(container);

    // Since Russia's invasion of Ukraine, Leaflet itself (not OpenStreetMap)
    // auto-adds a Ukrainian flag to its attribution control's "prefix"
    // segment - a separate piece from the tile attribution text below.
    // Setting our own tile attribution isn't enough to remove it; the
    // prefix has to be cleared explicitly too.
    this.map.attributionControl.setPrefix(false);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    const markers = groupByPlace(tours).map((group) => this.createMarker(group));
    for (const marker of markers) marker.addTo(this.map);

    // Always shows every marker on load, rather than some fixed default
    // zoom that might crop tours out.
    if (markers.length) {
      this.map.fitBounds(L.featureGroup(markers).getBounds(), {
        padding: [30, 30],
      });
    } else {
      this.map.setView([47.1625, 19.5033], 7); // fallback: roughly Hungary's center
    }
  }

  // One pin per place - a single tour, or several (we went back to the
  // same place) with the count shown in the pin's head instead of the
  // hole. The pin itself is NOT a link: hovering it (desktop) or tapping
  // it (mobile) opens a small popup listing the tour(s), and the rows in
  // there are the links. A popup rather than a tooltip, since a Leaflet
  // tooltip vanishes the moment the mouse leaves the pin, so nothing in it
  // could ever be clicked.
  private createMarker(group: Tour[]): L.Marker {
    const [lng, lat] = group[0].location.coordinates;
    const marker = L.marker([lat, lng], { icon: pinIcon(group.length) });
    const popup = L.popup({
      className: 'tour-popup',
      closeButton: false,
      autoPan: true,
      offset: [0, group.length > 1 ? -GROUP_PIN.height + 4 : -SINGLE_PIN.height + 4],
    }).setContent(this.popupContent(group));

    // Hover-to-open with a short grace period on the way out, so the mouse
    // can travel from the pin up into the popup (and back) without it
    // closing in between. On a phone the tap below does the opening, and
    // tapping anywhere else on the map closes it (Leaflet's closeOnClick).
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      clearTimeout(closeTimer);
      if (!popup.isOpen()) marker.openPopup();
    };
    const scheduleClose = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => marker.closePopup(), 300);
    };

    // Not bindPopup's own click handling - that toggles, so a click right
    // after the hover already opened it would close it again.
    marker.bindPopup(popup);
    marker.off('click');
    marker.on('mouseover', open);
    marker.on('mouseout', scheduleClose);
    marker.on('click', open);
    // Leaflet creates the popup's element on its first open and reuses it
    // afterwards - hook it up just that once.
    let hooked = false;
    popup.on('add', () => {
      const el = popup.getElement();
      if (!el || hooked) return;
      hooked = true;
      el.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      el.addEventListener('mouseleave', scheduleClose);
    });

    return marker;
  }

  // Built as real DOM (not an HTML string) so a tour title can never be
  // interpreted as markup. Real <a href>s, so middle-click/"open in new
  // tab" works too - a plain left click goes through the Angular router
  // instead of a full page reload.
  private popupContent(group: Tour[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'tour-popup-list';
    for (const tour of group) {
      const link = document.createElement('a');
      link.className = 'tour-popup-link';
      link.href = `/taborok/${tour.slug}`;
      link.textContent = `${tour.order}. ${tour.title} (${new Date(tour.startDate).getFullYear()})`;
      link.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        this.router.navigate(['/taborok', tour.slug]);
      });
      list.appendChild(link);
    }
    return list;
  }

  // Leaflet measures and caches its container's size once and never
  // notices a plain CSS-driven resize (like the .map-fullscreen class
  // toggled below) on its own - invalidateSize() forces it to re-measure,
  // otherwise the map would keep rendering at its old (pre-toggle) size
  // inside the new box. requestAnimationFrame (not afterNextRender - this
  // runs from a template click handler, outside any injection context)
  // defers it to the next paint, by which point the browser has actually
  // applied the new .map-fullscreen layout.
  toggleFullscreen() {
    this.isFullscreen.update((v) => !v);
    requestAnimationFrame(() => this.map?.invalidateSize());
  }
}
