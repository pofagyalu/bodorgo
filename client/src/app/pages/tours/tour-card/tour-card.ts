import { Component, input, computed, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Tour, TourService } from '../../../services/tour';
import { formatForint } from '../../../shared/format';

@Component({
  selector: 'app-tour-card',
  standalone: true,
  imports: [MatIconModule, NgOptimizedImage, RouterLink],
  templateUrl: './tour-card.html',
  styleUrl: './tour-card.scss',
})
export class TourCard {
  tour = input.required<Tour>();
  priority = input(false);
  readonly formatForint = formatForint;

  private tourService = inject(TourService);
  // null for a tour with no cover yet - the card shows a plain placeholder.
  coverUrl = computed(() => this.tourService.coverUrl(this.tour()));

  // Intl.DateTimeFormat rather than Angular's `date` pipe - this app
  // doesn't register Hungarian locale data, so the pipe's month names
  // silently fall back to English ("Sep." instead of "szept.") - same
  // reasoning as tour-details.ts's formattedStartDate.
  formattedStartDate = computed(() =>
    new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(this.tour().startDate)),
  );
}
