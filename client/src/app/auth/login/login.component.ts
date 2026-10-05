import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../auth.service';
import { NotificationsService } from '../../notifications/notifications.service';

// Angular 20 defaults components to standalone: true; this can no longer
// be declared in AuthModule (see auth.module.ts).
@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationsService);

  // Which login the server runs with: 'oidc' - on to Authentik; 'local' -
  // e-mail and password here (LOCAL_LOGIN=true in its .env). Nothing is
  // shown until it's known.
  mode = signal<'oidc' | 'local' | null>(null);
  email = signal('');
  password = signal('');
  loggingIn = signal(false);

  ngOnInit() {
    // authOidcController.js's callback() redirects here with this query
    // param when Authentik let someone in whom no admin has added in the
    // app (Klub → Felhasználók) - no session was created.
    const error = this.route.snapshot.queryParamMap.get('error');
    if (error === 'not-invited') {
      this.notifications.addError(
        'Még nem vagy felvéve a klub alkalmazásába - kérd meg egy admint, hogy vegyen fel.',
      );
    }
    // The provider doesn't say their e-mail address is confirmed, and it is
    // set to let in only those it does (Beállítások → OIDC szolgáltató).
    if (error === 'unverified-email') {
      this.notifications.addError(
        'Az e-mail címed még nincs megerősítve - erősítsd meg a belépéshez használt fiókodban, aztán próbáld újra.',
      );
    }
    this.authService
      .loginMode()
      .subscribe((res) => this.mode.set(res.localLogin ? 'local' : 'oidc'));
  }

  continueWithAuthentik() {
    this.authService.login();
  }

  logInWithPassword() {
    if (this.loggingIn() || !this.email().trim() || !this.password()) return;
    this.loggingIn.set(true);
    this.authService.localLogin(this.email().trim(), this.password()).subscribe({
      // A full page load, as after Authentik: the app starts logged in.
      next: () => this.goHome(),
      error: (err) => {
        this.loggingIn.set(false);
        this.password.set('');
        this.notifications.addError(err?.error?.message ?? 'A belépés nem sikerült.');
      },
    });
  }

  goHome() {
    window.location.href = '/';
  }
}
