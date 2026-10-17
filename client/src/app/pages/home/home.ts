import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { LOGIN_REFUSALS } from '../../auth/login-refusals';
import { NotificationsService } from '../../notifications/notifications.service';
import { LandingPage } from '../landing-page/landing-page';
import { HomePage } from '../homepage/homepage';

// Routed at '/' (see app.routes.ts). Switches between the public landing
// page and the richer, stats/map homepage depending on auth state, the
// same @if-on-auth.isLoggedIn() pattern the header already uses for its
// nav. Replaces the old home/home.component.ts, which just always showed
// the same content (Hero + Forecast + NotificationList) to everyone.
// NotificationList itself now lives in AppComponent (see app.component.html)
// so toasts work from any page, not just this one.
//
// A refused login lands here too (?error=..., see login-refusals.ts): it
// says why, and the address loses the error, so a reload doesn't say it
// again.
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [LandingPage, HomePage],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notifications = inject(NotificationsService);

  ngOnInit() {
    const error = this.route.snapshot.queryParamMap.get('error');
    if (!error) return;
    const message = LOGIN_REFUSALS[error];
    if (message) this.notifications.addError(message);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { error: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
