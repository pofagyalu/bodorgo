import { Component } from '@angular/core';

import { RouterOutlet, ChildrenOutletContexts } from '@angular/router';
import { Header } from './components/header/header';
import { routeFadeAnimation } from './animations';
import { AuthService } from './auth/auth.service';
import { NotificationListComponent } from './notifications/notification-list/notification-list.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Header, RouterOutlet, NotificationListComponent],
  animations: [routeFadeAnimation],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  constructor(
    private contexts: ChildrenOutletContexts,
    private authService: AuthService,
  ) {}

  ngOnInit() {
    this.authService.checkAuth().subscribe();
  }

  // Derived from the route's own configured path (e.g. "taborok", "chat")
  // rather than a manually-opted-in data.animation property - that only
  // covered two routes, so most page changes (Táborok, Chat, Profil, ...)
  // shared the same undefined value and never triggered a transition at
  // all. This way every route, including any added later, gets the
  // crossfade automatically with no per-route config needed.
  getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.routeConfig
      ?.path;
  }
}
