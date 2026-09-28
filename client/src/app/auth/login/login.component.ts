import { Component, OnInit, inject } from '@angular/core';
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
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationsService);

  ngOnInit() {
    // authOidcController.js's callback() redirects here with this query
    // param when Authentik let someone in whom no admin has added in the
    // app (Klub → Felhasználók) - no session was created.
    if (this.route.snapshot.queryParamMap.get('error') === 'not-invited') {
      this.notifications.addError(
        'Még nem vagy felvéve a klub alkalmazásába - kérd meg egy admint, hogy vegyen fel.',
      );
    }
  }

  continueWithAuthentik() {
    this.authService.login();
  }
}
