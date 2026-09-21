import { Component, input, computed } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Tour } from '../../../services/tour';
import { environment } from '../../../../environments/environment';
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
  environment = environment;
  readonly formatForint = formatForint;

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
