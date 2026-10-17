import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { NotificationsService } from '../../notifications/notifications.service';

// The emergency login's page, and nothing else: only when the server runs
// with LOCAL_LOGIN=true (its .env, during a restore) - the role manager's
// e-mail and password. Normally logging in goes straight to the provider
// (header's "Gyere bé!"), and whoever comes here - by an old link, typing
// it - is taken to the landing page. A refused login is said there too
// (pages/home, login-refusals.ts).
@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);

  // Which login the server runs with: 'local' - the form here; 'oidc' (or
  // the server can't be asked) - off to the landing page. Nothing is shown
  // until it's known.
  mode = signal<'oidc' | 'local' | null>(null);
  email = signal('');
  password = signal('');
  loggingIn = signal(false);

  ngOnInit() {
    this.authService.loginMode().subscribe((res) => {
      this.mode.set(res.localLogin ? 'local' : 'oidc');
      if (!res.localLogin) this.router.navigateByUrl('/', { replaceUrl: true });
    });
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
