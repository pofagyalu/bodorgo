import { Component } from '@angular/core';
import { HeroComponent } from '../hero/hero.component';
import { ForecastComponent } from '../weather/forecast/forecast.component';
import { NotificationListComponent } from '../notifications/notification-list/notification-list.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [HeroComponent, ForecastComponent, NotificationListComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent {}
