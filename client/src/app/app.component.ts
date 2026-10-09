import { Component, OnInit, effect, inject } from '@angular/core';

import { RouterOutlet, ChildrenOutletContexts } from '@angular/router';
import { Header } from './components/header/header';
import { routeFadeAnimation } from './animations';
import { AuthService } from './auth/auth.service';
import { FreshLoginService } from './auth/fresh-login.service';
import { VersionService } from './services/version';
import { OfflineService } from './services/offline';
import { SongService } from './services/song';
import { NotificationsService } from './notifications/notifications.service';
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
  private freshLogin = inject(FreshLoginService);
  private versionService = inject(VersionService);
  private offline = inject(OfflineService);
  private songService = inject(SongService);
  private notifications = inject(NotificationsService);

  // No connection: said in a line under the header.
  isOffline = this.offline.isOffline;

  constructor() {
    // The songbook is kept on the device for when there is no connection:
    // brought up to date once someone is logged in, and again whenever the
    // connection comes back.
    effect(() => {
      if (this.authService.isLoggedIn() && !this.offline.isOffline()) {
        void this.songService.keepForOffline();
        // ...and the songs added without one are sent.
        void this.songService.sendWaiting();
      }
    });
    // What became of them is said.
    effect(() => {
      const result = this.songService.lastSent();
      if (!result) return;
      if (result.sent) {
        this.notifications.addSuccess(
          result.sent === 1
            ? 'A kapcsolat nélkül felvett dalod feltöltve a daloskönyvbe.'
            : `A kapcsolat nélkül felvett ${result.sent} dalod feltöltve a daloskönyvbe.`,
        );
      }
      if (result.refused) {
        this.notifications.addError(
          'Egy kapcsolat nélkül felvett dalt a szerver nem fogadott el – a daloskönyvben „Javításra vár” jelzi.',
        );
      }
    });
  }

  ngOnInit() {
    // The service worker keeps the app itself on the device (src/sw.js).
    this.offline.start();
    // Back from identifying again for a sensitive operation: says so.
    this.authService.checkAuth().subscribe(() => this.freshLogin.announceReturn());
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
