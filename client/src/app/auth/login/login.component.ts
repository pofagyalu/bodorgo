import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../auth.service';
import { NotificationsService } from '../../notifications/notifications.service';

// Angular 20 defaults components to standalone: true; this can no longer
// be declared in AuthModule (see auth.module.ts).
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  constructor(
    private authService: AuthService,
    private route: ActivatedRoute,
    private notifications: NotificationsService,
  ) {}

  ngOnInit() {
    // authOidcController.js's callback() redirects here with this query
    // param when Authentik didn't send a valid bodorgo_role claim - the
    // login was denied outright, no local session was created.
    if (this.route.snapshot.queryParamMap.get('error') === 'no-role') {
      this.notifications.addError(
        'Nincs érvényes szerepköröd a klubban - vedd fel a kapcsolatot egy adminnal.',
      );
    }
  }

  continueWithAuthentik() {
    this.authService.login();
  }
}
