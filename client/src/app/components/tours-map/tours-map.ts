import { Component, inject, signal, ElementRef, viewChild, afterRenderEffect } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { TourService, Tour } from '../../services/tour';

// Self-contained: fetches its own tour list, so it can be dropped anywhere
// (currently just the homepage) without the parent needing to fetch and
// wire up data for it.
@Component({
  selector: 'app-tours-map',
  standalone: true,
  imports: [],
  templateUrl: './tours-map.html',
  styleUrl: './tours-map.scss',
})
export class ToursMap {
  private tourService = inject(TourService);
  private router = inject(Router);

  private tours = signal<Tour[]>([]);

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

    const markers: L.Marker[] = [];

    for (const tour of tours) {
      const [lng, lat] = tour.location.coordinates;
      if (lat == null || lng == null) continue;

      // A plain circle has no inherent "point", so its visual center (not
      // the anchored pixel) is what people read as the location - any
      // mismatch there gets visually amplified when zoomed out, since the
      // same pixel offset then covers a much larger real-world distance.
      // A pin shape with a sharp tip makes the anchor unambiguous: iconAnchor
      // below is set to that exact tip pixel.
      //
      // One single <path> (not a separate circle+polygon) so it always
      // reads as one cohesive pin rather than two overlapping pieces - the
      // order number lives in the hover tooltip only, not on the pin
      // itself, keeping this one simple unified shape. The classic
      // "Google Maps style" punched-out hole is a second circular subpath
      // inside the same d attribute, combined with fill-rule="evenodd" so
      // it renders as a hole rather than a separately-colored circle.
      const icon = L.divIcon({
        className: 'tour-marker',
        html: `
          <svg class="tour-pin" width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
            <path
              class="tour-pin-shape"
              fill-rule="evenodd"
              d="M15 0C7.8 0 2 5.8 2 13c0 9.75 13 27 13 27s13-17.25 13-27C28 5.8 22.2 0 15 0z M10 13a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z"
              stroke="#fff"
              stroke-width="1.5"
            ></path>
          </svg>
        `,
        iconSize: [30, 40],
        iconAnchor: [15, 40],
        popupAnchor: [0, -40],
      });

      const marker = L.marker([lat, lng], { icon })
        .bindTooltip(`${tour.order}. ${tour.title}`, { className: 'tour-tooltip' })
        .on('click', () => this.router.navigate(['/taborok', tour.slug]));

      marker.addTo(this.map);
      markers.push(marker);
    }

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
}
