// Futókörök: the badges of a futókör - who gets which animal.
//
// ─── SZERKESZTHETŐ RÉSZ ──────────────────────────────────────────────────
// A dobogósok (a legjobb körük szerint) és a leglassabb célba érő jelvénye:
// a jel, a neve, és amit az egér fölé húzva (vagy a jelmagyarázatban) ír.
// ──────────────────────────────────────────────────────────────────────────

export interface Badge {
  icon: string;
  name: string;
  about: string;
}

export const BADGES: Record<'first' | 'second' | 'third' | 'slowest', Badge> = {
  first: { icon: '🐆', name: 'Gepárd', about: 'a leggyorsabb kör' },
  second: { icon: '🦌', name: 'Szarvas', about: 'a második legjobb kör' },
  third: { icon: '🐇', name: 'Nyúl', about: 'a harmadik legjobb kör' },
  slowest: { icon: '🐢', name: 'Teknős', about: 'a legkényelmesebb célba érő' },
};

// A leglassabb jelvénye csak akkor jár, ha legalább ennyien célba értek
// (különben a dobogósok egyike kapná).
export const SLOWEST_FROM = 4;

// ─── INNENTŐL A PROGRAM ──────────────────────────────────────────────────

// Who gets which badge: `bests` are the runners who finished, with their
// best lap, in any order. Equal times: whoever is first in the list.
export function badgesOf(bests: { userId: string; totalMs: number }[]): Map<string, Badge> {
  const ranked = [...bests].sort((a, b) => a.totalMs - b.totalMs);
  const badges = new Map<string, Badge>();
  (['first', 'second', 'third'] as const).forEach((place, i) => {
    if (ranked[i]) badges.set(ranked[i].userId, BADGES[place]);
  });
  if (ranked.length >= SLOWEST_FROM) badges.set(ranked.at(-1)!.userId, BADGES.slowest);
  return badges;
}
