import { Component } from '@angular/core';
import { TourTicker } from '../components/tour-ticker/tour-ticker';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [TourTicker],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent {

}
