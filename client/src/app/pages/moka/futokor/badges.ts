// Futókörök: the badges of a futókör - who gets which animal.
//
// ─── SZERKESZTHETŐ RÉSZ ──────────────────────────────────────────────────
// A dobogósok (a legjobb körük szerint) és a leglassabb célba érő jelvénye:
// a jel, a neve és a leírása (a táblázatban csak a jel látszik). A jel
// lehet egy emoji (icon) - vagy egy kép (image): ha van kép, az látszik.
// A képek helye: client/src/assets/images/badges/ (SVG vagy PNG).
//
// A gepárd rajza: OpenMoji (openmoji.org), CC BY-SA 4.0 licenc.
// ──────────────────────────────────────────────────────────────────────────

export interface Badge {
  icon: string;
  // A picture instead of the emoji (an address under assets/).
  image?: string;
  name: string;
  about: string;
}

export const BADGES: Record<'first' | 'second' | 'third' | 'slowest', Badge> = {
  first: {
    icon: '🐆',
    image: 'assets/images/badges/gepard.svg',
    name: 'Gepárd',
    about: 'a leggyorsabb kör',
  },
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
