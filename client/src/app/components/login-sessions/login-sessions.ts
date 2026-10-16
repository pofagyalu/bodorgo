import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import { AuthService, LoginSessions as Sessions } from '../../auth/auth.service';
import { FreshLoginService } from '../../auth/fresh-login.service';
import { UserService } from '../../services/user';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Spinner } from '../../shared/spinner/spinner';

type Ended = { data: { appEnded: number; authentikEnded: number | null } };
// Someone else's come without "this browser".
type Shown = Omit<Sessions, 'here'> & { here?: Sessions['here'] };

// Bejelentkezések: the browsers logged in to Bódorgó, and the devices the
// Oridzsinátor (Authentik) remembers - those may log in again without a
// password. Two places:
// - Profilom, every user's own (no `user`): this browser marked, and
//   "Kijelentkezés minden más eszközön" - all of them but this one.
// - Someone's edit page, the role manager only (`user` set):
//   "Kijelentkeztetés mindenhonnan" - every one of theirs, after
//   identifying again (server userRoutes.js), into the Napló.
@Component({
  selector: 'app-login-sessions',
  imports: [DatePipe, MatIconModule, Spinner],
  templateUrl: './login-sessions.html',
  styleUrl: './login-sessions.scss',
})
export class LoginSessions implements OnInit {
  private auth = inject(AuthService);
  private userService = inject(UserService);
  private freshLogin = inject(FreshLoginService);
  private confirm = inject(ConfirmService);
  private notifications = inject(NotificationsService);

  // Whose: unset = mine.
  user = input<{ _id: string; name: string } | null>(null);

  sessions = signal<Shown | null>(null);
  error = signal('');
  busy = signal(false);

  // The app sessions with a device name, one row each (this one always);
  // the ones from before devices were saved (2026-10-15) are only counted.
  named = computed(() => (this.sessions()?.app ?? []).filter((s) => s.current || s.device));
  unnamedCount = computed(
    () => (this.sessions()?.app ?? []).filter((s) => !s.current && !s.device).length,
  );

  ngOnInit() {
    this.load();
  }

  private load() {
    const u = this.user();
    const request: Observable<{ data: Shown }> = u
      ? this.userService.getUserSessions(u._id)
      : this.auth.loginSessions();
    request.subscribe({
      next: (res) => this.sessions.set(res.data),
      error: () => this.error.set('A bejelentkezések betöltése nem sikerült.'),
    });
  }

  async logOut() {
    const u = this.user();
    const ok = await this.confirm.ask(
      u
        ? {
            title: 'Kijelentkeztetés mindenhonnan',
            message: `${u.name} minden eszközén kijelentkezik.`,
            detail:
              'Minden böngészőjében kilép a Bódorgóból, és az Oridzsinátor sem engedi vissza jelszó nélkül egyik eszközén sem. Bekerül a Naplóba.',
            confirmText: 'Kijelentkeztetés',
          }
        : {
            title: 'Kijelentkezés minden más eszközön',
            message: 'Minden más eszközödön kijelentkezel, ezen bejelentkezve maradsz.',
            detail:
              'A többi eszközön újra be kell majd lépned a jelszavaddal. Ezen az eszközön is jelszót kér az Oridzsinátor, amikor legközelebb odakerülsz.',
            confirmText: 'Kijelentkeztetés',
          },
    );
    if (!ok) return;
    if (u && !(await this.freshLogin.ensure('Kijelentkeztetés mindenhonnan'))) return;

    this.busy.set(true);
    const request: Observable<Ended> = u
      ? this.userService.logoutEverywhere(u._id)
      : this.auth.logoutOtherSessions();
    request.subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res.data.authentikEnded === null) {
          this.notifications.addError(
            u
              ? `${u.name} kilépett a Bódorgóból, de az Oridzsinátor most nem válaszolt - próbáld újra később.`
              : 'A többi eszközön kijelentkeztél, de az Oridzsinátor most nem válaszolt - próbáld újra később.',
          );
        } else {
          this.notifications.addSuccess(
            u
              ? `${u.name} minden eszközén kijelentkezett.`
              : 'Minden más eszközödön kijelentkeztél.',
          );
        }
        this.load();
      },
      error: () => {
        this.busy.set(false);
        this.notifications.addError('A kijelentkeztetés nem sikerült.');
      },
    });
  }

  // A phone or a computer, by the device's name.
  icon(device: string | null): string {
    return /Android|iPhone|iPad/.test(device ?? '') ? 'smartphone' : 'computer';
  }
}
