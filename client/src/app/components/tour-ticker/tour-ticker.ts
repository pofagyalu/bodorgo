import { Component, inject, signal, computed } from '@angular/core';
import { TourService, Tour } from '../../services/tour';

type FeaturedTour = {
  tour: Tour;
  label: 'Következő' | 'Legutóbbi';
};

@Component({
  selector: 'app-tour-ticker',
  templateUrl: './tour-ticker.html',
  styleUrl: './tour-ticker.scss',
})
export class TourTicker {
  private tourService = inject(TourService);

  private tours = signal<Tour[]>([]);

  // The soonest tour that hasn't fully ended yet (start + duration still in
  // the future) - "Következő". If every tour has already ended, falls back
  // to whichever one started most recently - "Legutóbbi". Public data (this
  // ticker lives on the logged-out landing page), so no auth needed here.
  private featuredTour = computed<FeaturedTour | null>(() => {
    const list = this.tours();
    if (list.length === 0) return null;

    const now = Date.now();
    const withEndTime = list.map((tour) => ({
      tour,
      endTime: new Date(tour.startDate).getTime() + tour.duration * 24 * 60 * 60 * 1000,
    }));

    const notYetEnded = withEndTime
      .filter((x) => x.endTime > now)
      .sort((a, b) => new Date(a.tour.startDate).getTime() - new Date(b.tour.startDate).getTime());
    if (notYetEnded.length > 0) {
      return { tour: notYetEnded[0].tour, label: 'Következő' };
    }

    const mostRecent = [...withEndTime].sort(
      (a, b) => new Date(b.tour.startDate).getTime() - new Date(a.tour.startDate).getTime(),
    )[0];
    return mostRecent ? { tour: mostRecent.tour, label: 'Legutóbbi' } : null;
  });

  tickerText = computed(() => {
    const featured = this.featuredTour();
    if (!featured) return '';
    const { tour, label } = featured;
    const date = new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(tour.startDate));
    return `${label} bódorgó tábor a ${tour.order}-ik  •  ${tour.title}  •  ${tour.location.description}  •  ${date}`;
  });

  constructor() {
    this.tourService.getTours().subscribe({
      next: (res) => this.tours.set(res.data.tours),
    });
  }
}
