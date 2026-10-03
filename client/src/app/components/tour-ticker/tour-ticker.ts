import { Component, inject, signal, computed } from '@angular/core';
import { TourService, TickerResponse } from '../../services/tour';

// The logged-out landing page's scrolling line about the next tour (or,
// once every tour has ended, the latest one). Tours are otherwise
// members-only - this reads the one public endpoint made just for it,
// which picks the tour and returns only the fields printed here (see
// tourController.js's getTicker).
@Component({
  selector: 'app-tour-ticker',
  templateUrl: './tour-ticker.html',
  styleUrl: './tour-ticker.scss',
})
export class TourTicker {
  private tourService = inject(TourService);

  // undefined: not answered yet; null: there is no tour to tell about.
  private featured = signal<TickerResponse['data'] | undefined>(undefined);

  // The bar keeps its place from the start (see tour-ticker.html) - it
  // goes only once it is known to have nothing to say.
  shown = computed(() => this.featured() !== null);

  tickerText = computed(() => {
    const featured = this.featured();
    if (!featured) return '';
    const date = new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(featured.startDate));
    return `${featured.label} bódorgó tábor a ${featured.order}-ik  •  ${featured.title}  •  ${featured.place}  •  ${date}`;
  });

  constructor() {
    this.tourService.getTicker().subscribe({
      next: (res) => this.featured.set(res.data),
      error: () => this.featured.set(null),
    });
  }
}
