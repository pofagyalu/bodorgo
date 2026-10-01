import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TourService, TourStatsResponse } from '../../services/tour';
import { ToursMap } from '../../components/tours-map/tours-map';
import { AgeChart } from '../../components/age-chart/age-chart';
import { shuffledLogoColors } from '../../shared/logo-colors';
import { SiteFooter } from '../../shared/site-footer/site-footer';

@Component({
  selector: 'app-homepage',
  standalone: true,
  imports: [MatIconModule, RouterLink, ToursMap, SiteFooter, AgeChart],
  templateUrl: './homepage.html',
  styleUrl: './homepage.scss',
})
export class HomePage {
  private tourService = inject(TourService);

  stats = signal<TourStatsResponse['data'] | null>(null);

  // Picked once per page view, one per icon off a shuffled copy of the 7
  // logo colors - a permutation, so none of these 4 can repeat (there are
  // 3 colors that won't be used on any given page view).
  private readonly iconColors = shuffledLogoColors();
  totalToursIconColor = this.iconColors[0];
  totalParticipantsIconColor = this.iconColors[1];
  mostAttendedIconColor = this.iconColors[2];
  bestRatedIconColor = this.iconColors[3];

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

  // How much older the attendees get a year, for the line under the age
  // chart's title ("0,8"): the slope of the straight line that fits the
  // yearly averages best (least squares) - every year has its say, not
  // just the first and the last. null until there are two years to
  // compare. `slower`: under a year a year, which is what the line's joke
  // (slower than biology would allow) is about.
  agingRate = computed(() => {
    const years = this.stats()?.attendeeAges?.years ?? [];
    if (years.length < 2) return null;
    const meanYear = years.reduce((sum, y) => sum + y.year, 0) / years.length;
    const meanAge = years.reduce((sum, y) => sum + y.averageAge, 0) / years.length;
    const slope =
      years.reduce((sum, y) => sum + (y.year - meanYear) * (y.averageAge - meanAge), 0) /
      years.reduce((sum, y) => sum + (y.year - meanYear) ** 2, 0);
    const text = new Intl.NumberFormat('hu-HU', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(slope);
    return { text, slower: Math.round(slope * 10) < 10 };
  });

  constructor() {
    this.tourService.getTourStats().subscribe({
      next: (res) => this.stats.set(res.data),
      error: (err) => console.error('Failed to load tour stats:', err),
    });
  }
}
