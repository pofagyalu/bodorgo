import { Component, OnInit, inject } from '@angular/core';

import { RouterOutlet, ChildrenOutletContexts } from '@angular/router';
import { Header } from './components/header/header';
import { routeFadeAnimation } from './animations';
import { AuthService } from './auth/auth.service';
import { VersionService } from './services/version';
import { NotificationListComponent } from './notifications/notification-list/notification-list.component';
import { ConfirmDialog } from './shared/confirm-dialog/confirm-dialog';
import { BirthdayCelebration } from './shared/birthday/birthday-celebration';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Header, RouterOutlet, NotificationListComponent, ConfirmDialog, BirthdayCelebration],
  animations: [routeFadeAnimation],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private contexts = inject(ChildrenOutletContexts);
  private authService = inject(AuthService);
  private versionService = inject(VersionService);

  ngOnInit() {
    this.authService.checkAuth().subscribe();
    // A newer deploy: the open app refreshes itself (services/version.ts).
    this.versionService.watchForNewVersion();
  }

  // Derived from the route's own configured path (e.g. "taborok", "chat")
  // rather than a manually-opted-in data.animation property - that only
  // covered two routes, so most page changes (Táborok, Chat, Profil, ...)
  // shared the same undefined value and never triggered a transition at
  // all. This way every route, including any added later, gets the
  // crossfade automatically with no per-route config needed.
  getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.routeConfig?.path;
  }
}
