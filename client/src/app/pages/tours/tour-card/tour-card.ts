import { Component, input, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Tour, TourService } from '../../../services/tour';
import { formatForint } from '../../../shared/format';
import { CoverPlaceholder } from '../../../shared/cover-placeholder/cover-placeholder';

@Component({
  selector: 'app-tour-card',
  standalone: true,
  imports: [MatIconModule, NgOptimizedImage, RouterLink, CoverPlaceholder],
  templateUrl: './tour-card.html',
  styleUrl: './tour-card.scss',
})
export class TourCard {
  tour = input.required<Tour>();
  priority = input(false);
  readonly formatForint = formatForint;

  private tourService = inject(TourService);
  // null for a tour with no cover yet - the card shows the "Hamarosan"
  // placeholder; so it does when the cover can't be loaded (coverFailed).
  coverUrl = computed(() => this.tourService.coverUrl(this.tour()));
  coverFailed = signal(false);

  // Intl.DateTimeFormat rather than Angular's `date` pipe - this app
  // doesn't register Hungarian locale data, so the pipe's month names
  // silently fall back to English ("Sep." instead of "szept.") - same
  // reasoning as tour-details.ts's formattedStartDate.
  // The weather outlook as a small pill on the cover (see tour-details'
  // tour-weather-outlook for the whole of it) - nothing while the tour has
  // no outlook, and nothing once it has ended.
  outlookPill = computed(() => {
    const tour = this.tour();
    const outlook = tour.weatherOutlook;
    if (!outlook) return null;
    const end = new Date(tour.startDate);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + tour.duration);
    if (end.getTime() <= Date.now()) return null;
    return {
      word: outlook.word,
      tag: outlook.tag,
      badge: `assets/images/weather-outlook/badges/badge-${outlook.tier}.svg`,
      // Still an early guess: a dashed edge.
      early: !!outlook.note,
    };
  });

  formattedStartDate = computed(() =>
    new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(this.tour().startDate)),
  );
}
