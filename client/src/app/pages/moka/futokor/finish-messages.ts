// Futókörök: the line under the time when a run is over - a record, a
// personal best, or something to smile at.
//
// ─── SZERKESZTHETŐ RÉSZ ──────────────────────────────────────────────────
// A szövegek és a határok itt vannak, egy helyen. Egy üzenethez több szöveg
// is tartozhat: a telefon véletlenszerűen választ közülük, így nem mindig
// ugyanaz jön. Új szöveg: egy új sor az idézőjelek között, vesszővel a
// végén. A kapcsos zárójeles részeket a program tölti ki:
//   {n}      hányadik kör ma
//   {kulonbseg}  mennyivel jobb az eddigi legjobbnál ("0:23")
//   {hely}   hányadik helyen áll most
// ──────────────────────────────────────────────────────────────────────────

// A határok (tempó: másodperc / km - 12:00/km = 720).
export const LIMITS = {
  // Ennél lassabb: "gombát is szedtél?"
  verySlowPace: 15 * 60,
  // Ennél lassabb: "inkább gyaloglás"
  slowPace: 12 * 60,
  // Ettől a slowPace-ig: "kellemes kocogás"
  jogPace: 9 * 60,
  // Ennél gyorsabb: "biciklivel jöttél?"
  fastPace: 4 * 60,
  // Ennyin belül az egyéni csúcshoz (ezredmásodperc): "hajszál híja"
  nearMissMs: 5 * 1000,
  // Ennyiszer lassabb az egyéni csúcsnál: "volt ez már jobb is"
  muchSlowerTimes: 1.3,
  // Ennyiedik körtől ma: "nincs egyéb dolgod?"
  manyRunsToday: 3,
  // Ez előtt (óra) indulva: korán kelő; ettől indulva: éjszakai bagoly
  earlyHour: 7,
  lateHour: 21,
};

// A komoly üzenetek: ha több is igaz, a listában előbb álló nyer.
export const SERIOUS = {
  record: ['Új pályarekord! Jelenleg te vezeted a listát.'],
  // Nincs net: a telefon csak azt tudja, amit legutóbb látott.
  maybeRecord: ['Lehet, hogy ez pályarekord – amint lesz net, kiderül!'],
  personalBest: ['Egyéni csúcs! {kulonbseg}-mal jobb, mint az eddigi legjobbad.'],
  podium: ['Dobogós idő – jelenleg a {hely}. helyen állsz.'],
  firstFinish: ['Megvan az első köröd! Innen már csak gyorsulni lehet.'],
};

// A vicces üzenetek: ami igaz a futásra, azok közül egy jön, véletlenszerűen.
export const FUNNY = {
  verySlow: ['Gombát is szedtél útközben?', 'A csigák már aggódtak érted.'],
  slow: ['Ez már inkább gyaloglás volt!', 'Szép séta volt – legközelebb futunk is?'],
  jog: ['Kellemes kocogás – a csigák azért idegesek lettek.'],
  fast: ['Biztos, hogy nem biciklivel jöttél?', 'Ez villámgyors volt – a kártyák még füstölnek.'],
  nearMiss: ['Hajszál híja volt! Még egy kör?'],
  muchSlower: ['Volt ez már jobb is… fáradunk?'],
  manyToday: ['Ma már a {n}. köröd – nincs egyéb dolgod?'],
  early: ['Korán kelő futó aranyat lel.'],
  late: ['Éjszakai bagoly üzemmód.'],
  cameBack: ['Na ugye, hogy megvan mind!'],
};

// Feladáskor.
export const GAVE_UP = [
  'Ez a futás nem számít. Jöhet egy új!',
  'Semmi baj, a pálya holnap is itt lesz.',
];

// ─── INNENTŐL A PROGRAM ──────────────────────────────────────────────────

// What the phone knows about a run that has just finished.
export interface FinishFacts {
  totalMs: number;
  paceSecPerKm: number | null;
  // When it started (the phone's clock).
  startedAt: number;
  // My earlier finished times on this course - null if the phone doesn't
  // know them (no connection since it was opened).
  myEarlier: number[] | null;
  // How many runs I started on this course today, this one too - null if
  // not known.
  runsToday: number | null;
  // The course's best times (each runner's best, the fastest first), as
  // the phone last had them - null if it never did.
  records: number[] | null;
  // Is there a connection - is `records` likely to be fresh?
  online: boolean;
  // This run came to the FINISH once with a point missing, and went back.
  cameBack: boolean;
}

export interface FinishMessage {
  text: string;
  // 'record' and 'best' stand out on the screen.
  kind: 'record' | 'best' | 'good' | 'fun';
}

const mmss = (ms: number) => {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// One of the texts (`random`: 0..1, the tests give their own), filled in.
function say(
  texts: string[],
  random: () => number,
  values: Record<string, string | number> = {},
): string {
  const text = texts[Math.floor(random() * texts.length)] ?? texts[0];
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => String(values[key] ?? whole));
}

// The line for a finished run - null if there's nothing to say.
export function finishMessage(
  facts: FinishFacts,
  random: () => number = Math.random,
): FinishMessage | null {
  const { totalMs, myEarlier, records } = facts;
  const myBest = myEarlier?.length ? Math.min(...myEarlier) : null;
  // Better than I ever was here (or my first time in).
  const improved = myBest === null || totalMs < myBest;

  // --- The serious ones: where this time puts me ---
  if (records && myEarlier && improved) {
    // The others' bests: mine (the old one) isn't one of them.
    const others = [...records];
    if (myBest !== null && others.includes(myBest)) others.splice(others.indexOf(myBest), 1);
    const place = others.filter((ms) => ms <= totalMs).length + 1;
    if (place === 1) {
      return {
        text: say(facts.online ? SERIOUS.record : SERIOUS.maybeRecord, random),
        kind: 'record',
      };
    }
    if (myBest !== null) {
      return {
        text: say(SERIOUS.personalBest, random, { kulonbseg: mmss(myBest - totalMs) }),
        kind: 'best',
      };
    }
    if (place <= 3 && facts.online) {
      return { text: say(SERIOUS.podium, random, { hely: place }), kind: 'good' };
    }
  }
  if (myEarlier && myBest !== null && totalMs < myBest) {
    return {
      text: say(SERIOUS.personalBest, random, { kulonbseg: mmss(myBest - totalMs) }),
      kind: 'best',
    };
  }
  if (myEarlier && !myEarlier.length) {
    return { text: say(SERIOUS.firstFinish, random), kind: 'good' };
  }

  // --- The funny ones: whichever fit, one of them ---
  const pace = facts.paceSecPerKm;
  const hour = new Date(facts.startedAt).getHours();
  const fits: string[] = [];
  if (facts.cameBack) fits.push(say(FUNNY.cameBack, random));
  if (pace !== null) {
    if (pace > LIMITS.verySlowPace) fits.push(say(FUNNY.verySlow, random));
    else if (pace > LIMITS.slowPace) fits.push(say(FUNNY.slow, random));
    else if (pace >= LIMITS.jogPace) fits.push(say(FUNNY.jog, random));
    else if (pace < LIMITS.fastPace) fits.push(say(FUNNY.fast, random));
  }
  if (myBest !== null) {
    if (totalMs - myBest <= LIMITS.nearMissMs) fits.push(say(FUNNY.nearMiss, random));
    else if (totalMs > myBest * LIMITS.muchSlowerTimes) fits.push(say(FUNNY.muchSlower, random));
  }
  if (facts.runsToday !== null && facts.runsToday >= LIMITS.manyRunsToday) {
    fits.push(say(FUNNY.manyToday, random, { n: facts.runsToday }));
  }
  if (hour < LIMITS.earlyHour) fits.push(say(FUNNY.early, random));
  if (hour >= LIMITS.lateHour) fits.push(say(FUNNY.late, random));

  if (!fits.length) return null;
  return { text: fits[Math.floor(random() * fits.length)] ?? fits[0], kind: 'fun' };
}

export const giveUpMessage = (random: () => number = Math.random) => say(GAVE_UP, random);
