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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    const markers: L.Marker[] = [];

    for (const tour of tours) {
      const [lng, lat] = tour.location.coordinates;
      if (lat == null || lng == null) continue;

      const icon = L.divIcon({
        className: 'tour-marker',
        html: `<div class="tour-marker-pin">${tour.order}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -34],
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
