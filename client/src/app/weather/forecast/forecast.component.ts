import { Component } from '@angular/core';
import { ForecastService } from '../forecast.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-forecast',
  templateUrl: './forecast.component.html',
  styleUrl: './forecast.component.css',
})
export class ForecastComponent {
  forecast$: Observable<
    { dateString: string; temp: number; weather: string; icon: string }[]
  >;

  constructor(forecastService: ForecastService) {
    this.forecast$ = forecastService.getForecast();
  }
}
