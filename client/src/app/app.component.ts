import { Component } from '@angular/core';

import { RouterOutlet, ChildrenOutletContexts } from '@angular/router';
import { Header } from './components/header/header';
import { slideInAnimation } from './animations';
import { AuthService } from './auth/auth.service';
import { NotificationListComponent } from './notifications/notification-list/notification-list.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Header, RouterOutlet, NotificationListComponent],
  animations: [slideInAnimation],
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

  getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.data?.[
      'animation'
    ];
  }
}
