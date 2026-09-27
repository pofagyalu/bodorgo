import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title?: string; // an optional heading above the question
  message: string;
  detail?: string; // an optional smaller, grey note under it
  confirmText?: string; // default: 'Törlés'
  cancelText?: string; // default: 'Mégse'
  // A red confirm button (deleting something) - the default; false makes
  // it green.
  danger?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

// The app's own "are you sure?" dialog, instead of the browser's
// confirm(): `if (!(await this.confirm.ask({ message: '...' }))) return;`
// Shown by shared/confirm-dialog (placed once, in app.component.html);
// messages and errors after the action go to NotificationsService.
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<PendingConfirm | null>(null);

  ask(request: ConfirmRequest): Promise<boolean> {
    // A new question while one is open answers the old one with "no".
    this.pending()?.resolve(false);
    return new Promise((resolve) => this.pending.set({ ...request, resolve }));
  }

  answer(ok: boolean) {
    const p = this.pending();
    if (!p) return;
    this.pending.set(null);
    p.resolve(ok);
  }
}
