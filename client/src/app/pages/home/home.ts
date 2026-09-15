import { Component, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { LandingPage } from '../landing-page/landing-page';
import { HomePage } from '../homepage/homepage';

// Routed at '/' (see app.routes.ts). Switches between the public landing
// page and the richer, stats/map homepage depending on auth state, the
// same @if-on-auth.isLoggedIn() pattern the header already uses for its
// nav. Replaces the old home/home.component.ts, which just always showed
// the same content (Hero + Forecast + NotificationList) to everyone.
// NotificationList itself now lives in AppComponent (see app.component.html)
// so toasts work from any page, not just this one.
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [LandingPage, HomePage],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  auth = inject(AuthService);
}
