import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { ConfirmService } from '../shared/confirm-dialog/confirm.service';
import { NotificationsService } from '../notifications/notifications.service';

// Kept for the way to the provider and back (this tab only): they were sent
// to identify themselves.
const ASKED_KEY = 'bodorgo.freshLoginAsked';

// What moves money or rights (a role, a cash payment, a payout, where a
// payout goes) the server only does for someone who identified themselves
// at the provider in the last ten minutes (server auth/freshLogin.js) - a
// login lasts 90 days, and a phone can be left somewhere. So before such an
// operation: `if (!(await this.freshLogin.ensure('...'))) return;`
@Injectable({ providedIn: 'root' })
export class FreshLoginService {
  private auth = inject(AuthService);
  private confirm = inject(ConfirmService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);

  // True: go on. False: they said no, or are on their way to the provider -
  // it brings them back to this same page, where they start the operation
  // again. `what` names the operation, as the dialog's first words.
  async ensure(what: string): Promise<boolean> {
    if (this.auth.hasFreshLogin()) return true;
    // Identified since on another tab, perhaps: the server knows.
    await firstValueFrom(this.auth.checkAuth());
    if (this.auth.hasFreshLogin()) return true;

    const ok = await this.confirm.ask({
      title: 'Azonosítás szükséges',
      message: `${what}: ehhez újra azonosítanod kell magad.`,
      detail:
        'Ez a művelet pénzt vagy jogosultságot érint, ezért csak az végezheti el, aki az elmúlt 10 percben igazolta, hogy ő az. Az azonosítás után ide térsz vissza, és újra elindíthatod - amit a lapon addig nem mentettél el, az elvész.',
      confirmText: 'Azonosítás',
      danger: false,
    });
    if (ok) {
      try {
        sessionStorage.setItem(ASKED_KEY, '1');
      } catch {
        // No storage: they just get no message on the way back.
      }
      this.auth.identifyAgain(this.router.url);
    }
    return false;
  }

  // Back from the provider (the app starts again, see app.component.ts):
  // says whether it worked - the page looks the same as before, and the
  // operation is theirs to start again.
  announceReturn() {
    try {
      if (!sessionStorage.getItem(ASKED_KEY)) return;
      sessionStorage.removeItem(ASKED_KEY);
    } catch {
      return;
    }
    if (this.auth.hasFreshLogin()) {
      this.notifications.addSuccess(
        'Sikeres azonosítás. Most indítsd el újra a műveletet - 10 percig nem kérdezünk újra.',
      );
    } else {
      this.notifications.addError('Az azonosítás nem sikerült - a művelethez próbáld újra.');
    }
  }
}
