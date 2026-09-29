import { Component, effect, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { BirthdayService } from './birthday.service';

// The birthday (or new rank) greeting card in the middle of the screen (the confetti is
// canvas-confetti's own canvas) - placed once in the app root, so it shows
// on whichever page someone lands on. Asks the server once, after login.
// A click (or Esc) closes it early; the confetti needs no closing.
@Component({
  selector: 'app-birthday-celebration',
  template: `
    @if (birthday.message(); as text) {
      <button type="button" class="greeting" (click)="birthday.dismiss()" aria-live="polite">
        <span class="cake" aria-hidden="true">{{ birthday.icon() }}</span>
        <span class="text">{{ text }}</span>
      </button>
    }
  `,
  styleUrl: './birthday-celebration.scss',
  host: { '(document:keydown.escape)': 'birthday.dismiss()' },
})
export class BirthdayCelebration {
  birthday = inject(BirthdayService);
  private auth = inject(AuthService);

  constructor() {
    effect(() => {
      if (this.auth.isLoggedIn()) this.birthday.check();
    });
  }
}
