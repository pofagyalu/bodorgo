// The celebration effects (canvas-confetti, loaded only when one plays):
// used by the birthday / new rank greeting (shared/birthday) and the
// winners' podium (shared/podium).

export type CelebrationEffect = 'confetti' | 'fireworks' | 'cannons' | 'stars' | 'snow' | 'emoji';

type Confetti = typeof import('canvas-confetti');

// The club's colours, and a few festive ones.
const COLORS = ['#72b45d', '#1a796c', '#fb8c00', '#f6b528', '#e0457b', '#1e88e5', '#ffffff'];

// Above everything (the header, dialogs); the canvas never takes clicks.
const base = { zIndex: 40000, colors: COLORS, disableForReducedMotion: true };
const rand = (min: number, max: number) => Math.random() * (max - min) + min;

// Calls `frame` every `every` ms until `durationMs` is up, with the share
// of time left (1 -> 0) - for effects that fade out.
function repeat(durationMs: number, every: number, frame: (left: number) => void) {
  const end = Date.now() + durationMs;
  const timer = setInterval(() => {
    const left = (end - Date.now()) / durationMs;
    if (left <= 0) return clearInterval(timer);
    frame(left);
  }, every);
}

const EFFECTS: Record<
  CelebrationEffect,
  (confetti: Confetti, durationMs: number, emojis: string[]) => void
> = {
  // Bursts falling from the top, all across the screen.
  confetti: (confetti, ms) =>
    repeat(ms, 300, (left) =>
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
  fireworks: (confetti, ms) =>
    repeat(ms, 250, (left) => {
      const particleCount = Math.round(50 * left) + 10;
      const shot = { ...base, particleCount, spread: 360, startVelocity: 30, ticks: 60 };
      confetti({ ...shot, origin: { x: rand(0.1, 0.3), y: rand(0.1, 0.5) } });
      confetti({ ...shot, origin: { x: rand(0.7, 0.9), y: rand(0.1, 0.5) } });
    }),

  // Two cannons from the bottom corners, shooting inwards.
  cannons: (confetti, ms) =>
    repeat(ms, 60, () => {
      const shot = { ...base, particleCount: 3, spread: 55, startVelocity: 60 };
      confetti({ ...shot, angle: 60, origin: { x: 0, y: 0.8 } });
      confetti({ ...shot, angle: 120, origin: { x: 1, y: 0.8 } });
    }),

  // Golden stars bursting from the middle, a few times.
  stars: (confetti, ms) =>
    repeat(ms, 900, () => {
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
  snow: (confetti, ms) =>
    repeat(ms, 40, (left) =>
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

  // Emojis raining down.
  emoji: (confetti, ms, emojis) => {
    const scalar = 2.2;
    const shapes = emojis.map((text) => confetti.shapeFromText({ text, scalar }));
    repeat(ms, 350, (left) =>
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

// Plays an effect for `durationMs`. Nothing happens when the phone or
// computer asks for reduced motion.
export async function playCelebration(
  effect: CelebrationEffect,
  durationMs: number,
  emojis: string[] = ['🎉'],
) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { default: confetti } = await import('canvas-confetti');
  EFFECTS[effect](confetti, durationMs, emojis);
}
