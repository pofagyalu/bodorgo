import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

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

export type BirthdayEffect = 'confetti' | 'fireworks' | 'cannons' | 'stars' | 'snow' | 'emoji';

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
// The club's colours, and a few festive ones.
const COLORS = ['#72b45d', '#1a796c', '#fb8c00', '#f6b528', '#e0457b', '#1e88e5', '#ffffff'];

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

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const { default: confetti } = await import('canvas-confetti');
    EFFECTS[effect](confetti, EMOJIS[kind]);
  }
}

type Confetti = typeof import('canvas-confetti');

// Above everything (the header, dialogs); the canvas never takes clicks.
const base = { zIndex: 40000, colors: COLORS, disableForReducedMotion: true };
const rand = (min: number, max: number) => Math.random() * (max - min) + min;

// Calls `frame` every `every` ms until CONFETTI_MS is up, with the share of
// time left (1 -> 0) - for effects that fade out.
function repeat(every: number, frame: (left: number) => void) {
  const end = Date.now() + CONFETTI_MS;
  const timer = setInterval(() => {
    const left = (end - Date.now()) / CONFETTI_MS;
    if (left <= 0) return clearInterval(timer);
    frame(left);
  }, every);
}

const EFFECTS: Record<BirthdayEffect, (confetti: Confetti, emojis: string[]) => void> = {
  // Bursts falling from the top, all across the screen.
  confetti: (confetti) =>
    repeat(300, (left) =>
      confetti({
        ...base,
        particleCount: Math.round(60 * left) + 10,
        angle: rand(250, 290),
        spread: 70,
        startVelocity: rand(15, 30),
        gravity: 0.9,
        ticks: 300,
        origin: { x: rand(0.05, 0.95), y: -0.1 },
      }),
    ),

  // Bursts all around, in the air.
  fireworks: (confetti) =>
    repeat(250, (left) => {
      const particleCount = Math.round(50 * left) + 10;
      const shot = { ...base, particleCount, spread: 360, startVelocity: 30, ticks: 60 };
      confetti({ ...shot, origin: { x: rand(0.1, 0.3), y: rand(0.1, 0.5) } });
      confetti({ ...shot, origin: { x: rand(0.7, 0.9), y: rand(0.1, 0.5) } });
    }),

  // Two cannons from the bottom corners, shooting inwards.
  cannons: (confetti) =>
    repeat(60, () => {
      const shot = { ...base, particleCount: 3, spread: 55, startVelocity: 60 };
      confetti({ ...shot, angle: 60, origin: { x: 0, y: 0.8 } });
      confetti({ ...shot, angle: 120, origin: { x: 1, y: 0.8 } });
    }),

  // Golden stars bursting from the middle, a few times.
  stars: (confetti) =>
    repeat(900, () => {
      const shot = {
        ...base,
        colors: ['#f6b528', '#ffd76a', '#fff3c4', '#fb8c00'],
        shapes: ['star' as const],
        spread: 360,
        ticks: 90,
        gravity: 0.3,
        decay: 0.94,
        startVelocity: 25,
        origin: { x: 0.5, y: 0.45 },
      };
      confetti({ ...shot, particleCount: 40, scalar: 1.2 });
      confetti({ ...shot, particleCount: 15, scalar: 0.7, shapes: ['circle' as const] });
    }),

  // A slow, gentle fall - like snow, in colours.
  snow: (confetti) =>
    repeat(40, (left) =>
      confetti({
        ...base,
        particleCount: 1,
        startVelocity: 0,
        ticks: Math.max(200, 500 * left),
        origin: { x: Math.random(), y: Math.random() * 0.3 - 0.2 },
        gravity: rand(0.4, 0.6),
        scalar: rand(0.6, 1.1),
        drift: rand(-0.4, 0.4),
      }),
    ),

  // 🎂🎉🎈🥳 (a rank: 🏅🎉✨🏆) raining down.
  emoji: (confetti, emojis) => {
    const scalar = 2.2;
    const shapes = emojis.map((text) => confetti.shapeFromText({ text, scalar }));
    repeat(350, (left) =>
      confetti({
        ...base,
        shapes,
        scalar,
        particleCount: Math.round(12 * left) + 4,
        angle: rand(250, 290),
        spread: 60,
        startVelocity: rand(10, 25),
        gravity: 0.7,
        ticks: 320,
        flat: true,
        origin: { x: rand(0.05, 0.95), y: -0.1 },
      }),
    );
  },
};
