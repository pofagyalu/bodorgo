import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TourService, TourStatsResponse } from '../../services/tour';
import { ToursMap } from '../../components/tours-map/tours-map';
import { randomLogoColor } from '../../shared/logo-colors';

@Component({
  selector: 'app-homepage',
  standalone: true,
  imports: [MatIconModule, RouterLink, ToursMap],
  templateUrl: './homepage.html',
  styleUrl: './homepage.scss',
})
export class HomePage {
  private tourService = inject(TourService);

  stats = signal<TourStatsResponse['data'] | null>(null);

  // Picked once per page view, one independently random logo color per
  // stat icon - same pattern as tour-details' info-line icons.
  totalToursIconColor = randomLogoColor();
  totalParticipantsIconColor = randomLogoColor();
  mostAttendedIconColor = randomLogoColor();
  bestRatedIconColor = randomLogoColor();

  constructor() {
    this.tourService.getTourStats().subscribe({
      next: (res) => this.stats.set(res.data),
      error: (err) => console.error('Failed to load tour stats:', err),
    });
  }
}
