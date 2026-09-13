import { Component, input } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Tour } from '../../../services/tour';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-tour-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, NgOptimizedImage, RouterLink],
  templateUrl: './tour-card.html',
  styleUrl: './tour-card.scss',
})
export class TourCard {
  tour = input.required<Tour>();
  priority = input(false);
  environment = environment;
}
