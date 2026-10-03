import { Component, OnDestroy, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { canNfc, writeCard } from './nfc';

// How long it waits for the sticker.
const WAIT_MS = 30 * 1000;

// A card's "NFC" button (only on a phone that can write NFC): a tap, then
// the phone is touched to the sticker - and the sticker says what the
// card's QR code does (its link), and what the card is called.
@Component({
  selector: 'app-nfc-write',
  imports: [MatIconModule],
  template: `
    @if (can) {
      <button
        type="button"
        class="nfc"
        (click)="write()"
        [title]="'NFC-címke írása: ' + name()"
        [attr.aria-label]="'NFC-címke írása: ' + name()"
      >
        <mat-icon>nfc</mat-icon>
        @if (label()) {
          <span>{{ label() }}</span>
        }
      </button>
      @if (waiting()) {
        <div class="wait" role="alertdialog" aria-live="assertive">
          <mat-icon>nfc</mat-icon>
          <p>
            Érintsd a telefon hátát a címkéhez…
            <strong>{{ name() }}</strong>
          </p>
          <button type="button" (click)="cancel()">Mégse</button>
        </div>
      }
    }
  `,
  styleUrl: './nfc-write.scss',
})
export class NfcWrite implements OnDestroy {
  private notifications = inject(NotificationsService);

  // The card's link, and what it's called on the sticker.
  url = input.required<string>();
  name = input.required<string>();
  // Written on the button, beside the icon.
  label = input('');

  readonly can = canNfc();
  waiting = signal(false);
  private stop?: AbortController;

  async write() {
    if (this.waiting()) return;
    this.stop = new AbortController();
    const timeout = setTimeout(() => this.stop?.abort(), WAIT_MS);
    this.waiting.set(true);
    try {
      await writeCard(this.url(), this.name(), this.stop.signal);
      navigator.vibrate?.(80);
      this.notifications.addSuccess(`Kész: a címke mostantól „${this.name()}”.`);
    } catch (err) {
      // (Called off, or nobody came with a sticker: nothing to tell.)
      if ((err as DOMException)?.name !== 'AbortError') {
        this.notifications.addError(
          (err as DOMException)?.name === 'NotAllowedError'
            ? 'Az NFC nincs engedélyezve – kapcsold be a telefonon, és engedélyezd a böngészőben.'
            : 'Nem sikerült a címkét megírni – tartsd rajta tovább, vagy próbálj másik címkét.',
        );
      }
    } finally {
      clearTimeout(timeout);
      this.waiting.set(false);
    }
  }

  cancel() {
    this.stop?.abort();
  }

  ngOnDestroy() {
    this.stop?.abort();
  }
}
