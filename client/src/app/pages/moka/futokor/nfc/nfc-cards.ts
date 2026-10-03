import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { canNfc, nfcAllowed, readCards } from './nfc';

// What the browser said when it wouldn't listen, in words.
const WHY: Record<string, string> = {
  NotAllowedError:
    'Az NFC ennél az oldalnál le van tiltva a böngészőben – a címsor melletti ikonnál (Engedélyek → NFC) engedélyezd, majd koppints újra',
  NotReadableError: 'Az NFC ki van kapcsolva a telefonon – kapcsold be, majd koppints újra',
  NotSupportedError: 'Ez a telefon vagy böngésző nem tud NFC-t olvasni',
};

// The cards' NFC stickers, read by the app itself (a phone that can: Chrome
// on Android). Once it listens it goes on listening wherever the runner is
// in the app - switched on at the START ("Indulhat?") or on the Futás page;
// the first time the browser asks whether it may, which takes a tap.
//
// A card touched goes to whoever is showing the run (the Futás page:
// `onCard`) - or, with nobody there, to the card's own address, which does
// what the link on the sticker would have.
@Injectable({ providedIn: 'root' })
export class NfcCards {
  private router = inject(Router);

  readonly can = canNfc();
  on = signal(false);
  // Why it didn't start - '' if nothing is wrong.
  problem = signal('');
  // Whoever takes the cards right now (the Futás page, while it's open).
  onCard: ((token: string) => void) | null = null;
  private starting = false;

  constructor() {
    // Allowed before: it listens right away.
    void nfcAllowed().then((allowed) => {
      if (allowed) void this.listen();
    });
  }

  async listen() {
    if (!this.can || this.on() || this.starting) return;
    this.starting = true;
    try {
      // (Never stopped: it's for as long as the app is open.)
      await readCards((token) => this.take(token), new AbortController().signal);
      this.on.set(true);
      this.problem.set('');
    } catch (err) {
      // With the browser's own name for it, to tell whoever looks after
      // the app.
      const name = (err as DOMException)?.name ?? '';
      this.problem.set(
        `${WHY[name] ?? 'Az NFC nem indult el – koppints újra'} (${name || 'hiba'})`,
      );
    } finally {
      this.starting = false;
    }
  }

  private take(token: string) {
    if (this.onCard) this.onCard(token);
    else void this.router.navigate(['/fk', token]);
  }
}
