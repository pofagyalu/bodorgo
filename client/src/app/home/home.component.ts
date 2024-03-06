import { Component } from '@angular/core';
import { HeroComponent } from '../hero/hero.component';
import { WeatherModule } from '../weather/weather.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [HeroComponent, WeatherModule, NotificationsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent {}
