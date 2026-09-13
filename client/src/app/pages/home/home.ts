import { Component, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { LandingPage } from '../landing-page/landing-page';
import { HomePage } from '../homepage/homepage';
import { NotificationListComponent } from '../../notifications/notification-list/notification-list.component';

// Routed at '/' (see app.routes.ts). Switches between the public landing
// page and the richer, stats/map homepage depending on auth state, the
// same @if-on-auth.isLoggedIn() pattern the header already uses for its
// nav. Replaces the old home/home.component.ts, which just always showed
// the same content (Hero + Forecast + NotificationList) to everyone.
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [LandingPage, HomePage, NotificationListComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  auth = inject(AuthService);
}
