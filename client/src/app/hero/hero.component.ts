import { Component } from '@angular/core';
import { TourTicker } from '../components/tour-ticker/tour-ticker';
import { SiteFooter } from '../shared/site-footer/site-footer';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [TourTicker, SiteFooter],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css',
})
export class HeroComponent {}
