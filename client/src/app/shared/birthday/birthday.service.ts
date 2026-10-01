import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CelebrationEffect, playCelebration } from '../celebration-effects';

// Születésnap: whoever logs in on their birthday gets confetti and a
// greeting (the server decides - GET /users/me/birthday - and shows it
// once a year). Rangok ünneplése: the same, the first login after reaching
// a new rank (10, 20, ... tours - GET /users/me/rank). Both are set up on
// Klub → Beállítások, whose "Előnézet" plays them right away. The greeting
// card itself is BirthdayCelebration, placed once in the app root.

// What's being celebrated - the card's icon and the emoji rain's emojis.
export type CelebrationKind = 'birthday' | 'rank';

const ICONS: Record<CelebrationKind, string> = { birthday: '🎂', rank: '🏅' };
const EMOJIS: Record<CelebrationKind, string[]> = {
  birthday: ['🎂', '🎉', '🎈', '🥳'],
  rank: ['🏅', '🎉', '✨', '🏆'],
};

// The effects themselves: shared/celebration-effects.ts.
export type BirthdayEffect = CelebrationEffect;

export const BIRTHDAY_EFFECTS: { key: BirthdayEffect; name: string }[] = [
  { key: 'confetti', name: 'Konfetti eső' },
  { key: 'fireworks', name: 'Tűzijáték' },
  { key: 'cannons', name: 'Oldalsó ágyúk' },
  { key: 'stars', name: 'Csillagszórás' },
  { key: 'snow', name: 'Lassú konfetti' },
  { key: 'emoji', name: 'Emoji eső' },
];

const CONFETTI_MS = 7000; // the effect
const MESSAGE_MS = 5000; // the greeting, then it fades out

@Injectable({ providedIn: 'root' })
export class BirthdayService {
  private http = inject(HttpClient);

  // The greeting on screen, or null - and its icon.
  message = signal<string | null>(null);
  icon = signal(ICONS.birthday);
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private checked = false;

  // Once per app start, after login: is it my birthday today, and did I
  // reach a new rank? Both on the same day: the rank's after the birthday's.
  check() {
    if (this.checked) return;
    this.checked = true;
    this.ask('birthday', () => this.ask('rank'));
  }

  private ask(kind: CelebrationKind, then?: () => void) {
    this.http
      .get<{
        data: { celebrate: boolean; effect?: BirthdayEffect; message?: string };
      }>(`${environment.apiBaseUrl}/users/me/${kind}`)
      .subscribe({
        next: (res) => {
          const d = res.data;
          const played = d.celebrate && !!d.effect && !!d.message;
          if (played) void this.play(d.effect!, d.message!, kind);
          if (then) setTimeout(then, played ? CONFETTI_MS : 0);
        },
        error: () => then?.(), // just no celebration
      });
  }

  dismiss() {
    clearTimeout(this.hideTimer);
    this.message.set(null);
  }

  // The effect for a few seconds, and the greeting in the middle. With
  // "reduce motion" asked for by the phone/computer, only the greeting.
  async play(effect: BirthdayEffect, message: string, kind: CelebrationKind = 'birthday') {
    clearTimeout(this.hideTimer);
    this.icon.set(ICONS[kind]);
    this.message.set(message);
    this.hideTimer = setTimeout(() => this.message.set(null), MESSAGE_MS);

    await playCelebration(effect, CONFETTI_MS, EMOJIS[kind]);
  }
}
