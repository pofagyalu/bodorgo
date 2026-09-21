import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TourService, TourStatsResponse } from '../../services/tour';
import { ToursMap } from '../../components/tours-map/tours-map';
import { shuffledLogoColors } from '../../shared/logo-colors';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-homepage',
  standalone: true,
  imports: [MatIconModule, RouterLink, ToursMap],
  templateUrl: './homepage.html',
  styleUrl: './homepage.scss',
})
export class HomePage {
  private tourService = inject(TourService);

  // Documents are served through a requireAuth-gated API route, not a
  // plain public client asset - see server/src/controllers/documentController.js.
  documentsUrl = `${environment.apiBaseUrl}/documents`;

  stats = signal<TourStatsResponse['data'] | null>(null);

  // Picked once per page view, one per icon off a shuffled copy of the 7
  // logo colors - a permutation, so none of these 6 can repeat (there's
  // exactly one color that won't be used on any given page view).
  private readonly iconColors = shuffledLogoColors();
  totalToursIconColor = this.iconColors[0];
  totalParticipantsIconColor = this.iconColors[1];
  mostAttendedIconColor = this.iconColors[2];
  bestRatedIconColor = this.iconColors[3];
  documentIconColor1 = this.iconColors[4];
  documentIconColor2 = this.iconColors[5];

  // Fixed rather than drawn from the shuffled logo-color pool - this is a
  // two-slice comparison chart with a conventional color meaning (blue for
  // male, red for female), not an arbitrary per-icon color.
  readonly maleColor = 'var(--logo-blue)';
  readonly femaleColor = 'var(--logo-red)';

  // A pure-CSS pie chart: two conic-gradient wedges, split at the male
  // percentage. Built here rather than inline in the template since the
  // split point is a runtime value. conic-gradient normally starts its
  // sweep at 12 o'clock, which puts a 50/50 split on a horizontal line
  // (top/bottom) - starting the sweep at 6 o'clock instead (`from 180deg`)
  // puts an even split on a vertical line, with blue occupying the left
  // half and red the right half, matching the male/female legend below it.
  genderPieBackground(malePercentage: number): string {
    return `conic-gradient(from 180deg, ${this.maleColor} 0% ${malePercentage}%, ${this.femaleColor} ${malePercentage}% 100%)`;
  }

  constructor() {
    this.tourService.getTourStats().subscribe({
      next: (res) => this.stats.set(res.data),
      error: (err) => console.error('Failed to load tour stats:', err),
    });
  }
}
