// What a tour's weather outlook says (see weatherOutlook.js) - none of it
// to be taken too seriously. Each mood has a few headlines; which one is
// shown changes from day to day.

export const TIER_TEXTS = {
  perfect: {
    // On the tour page, next to the mood badge.
    tag: 'Napszemüveges idő',
    // The mood in one word: on the tour list's pill, and beside the
    // Jóléti-index (whose bar runs from Pálinkás to Koktélos).
    word: 'Koktélos',
    headlines: [
      'Ezt az időt rendelni se lehetett volna jobbra',
      'Napszemüveg fel, kifogások le',
      'Még az égiek is bódorogni jönnek',
    ],
  },
  great: {
    tag: 'Kirándulóidő',
    word: 'Sörös',
    headlines: [
      'Jó idő lesz, erre már nem lehet fogni semmit',
      'Majdnem tökéletes – a maradékot hozzuk mi',
      'Szép napok jönnek, a rosszkedv maradjon otthon',
    ],
  },
  mixed: {
    tag: 'Vegyesfelvágott',
    word: 'Elmegy',
    headlines: [
      'Lesz itt minden, mint a búcsúban',
      'Az időjárás még nem döntötte el, mit akar',
      'Kicsit ilyen, kicsit olyan – öltözz hagymának',
    ],
  },
  gloomy: {
    tag: 'Szürke idő',
    word: 'Boros',
    headlines: [
      'Szürke ég, színes társaság',
      'A nap szabadságot vett ki. Mi is, csak mi eljövünk',
      'Borús idő, derűs csapat',
    ],
  },
  rough: {
    tag: 'Durva idő',
    word: 'Pálinkás',
    headlines: [
      'Nincs rossz idő, csak rossz ruha. Most kiderül',
      'Esik, fúj, hideg van. Megyünk',
      'Ilyenkor esik a legjobban a forró tea – meg ami benne van',
    ],
  },
};

// A day's kind, as it reads inside a sentence.
export const CONDITION_TEXTS = {
  clear: 'napsütés',
  'partly-cloudy': 'változó felhőzet',
  cloudy: 'felhős ég',
  fog: 'köd',
  rain: 'eső',
  snow: 'havazás',
  thunderstorm: 'zivatar',
};

// Sunday first, as Date#getDay counts. `onto`: "szombatra".
const WEEKDAYS = [
  { name: 'vasárnap', onto: 'vasárnapra' },
  { name: 'hétfő', onto: 'hétfőre' },
  { name: 'kedd', onto: 'keddre' },
  { name: 'szerda', onto: 'szerdára' },
  { name: 'csütörtök', onto: 'csütörtökre' },
  { name: 'péntek', onto: 'péntekre' },
  { name: 'szombat', onto: 'szombatra' },
];

export const LINE_TEXTS = {
  allGood: 'Minden nap jónak ígérkezik. Gyanúsan jónak.',
  worstDay: (weekday, condition, minC, maxC) =>
    `A leggyengébb napnak a ${WEEKDAYS[weekday].name} ígérkezik: ${CONDITION_TEXTS[condition]}, ${minC} és ${maxC} °C között.`,
  bestDay: (weekday) => `A nagy túrát ${WEEKDAYS[weekday].onto} érdemes időzíteni.`,
  uncertain:
    'Ez még korai jóslat: ilyenkor a meteorológusok is csak találgatnak, úgyhogy változhat.',
};

// Mit pakoljunk? - each thing with the reason it's on the list.
export const PACK_TEXTS = {
  tshirt: { name: 'Póló', why: ({ maxHigh }) => `Napközben akár ${maxHigh} °C is lehet` },
  sweater: {
    name: 'Meleg pulóver',
    why: ({ minLow }) => `Estére ${minLow} °C-ra hűl a levegő`,
  },
  jacket: {
    name: 'Meleg kabát',
    why: ({ minLow }) => `Éjjel ${minLow} °C körül – a csillagnézés nincs ingyen`,
  },
  beanie: {
    name: 'Sapka, kesztyű',
    why: ({ minLow }) => `Fagy is lehet (${minLow} °C), a fül nem nő vissza`,
  },
  umbrella: {
    name: 'Esőkabát vagy esernyő',
    why: ({ wetDays }) =>
      `${wetDays === 1 ? 'Egy' : wetDays} napon várható csapadék – nem vagyunk cukorból`,
  },
  sun: {
    name: 'Napszemüveg, naptej',
    why: ({ sunDays }) =>
      `${sunDays === 1 ? 'Egy' : sunDays} napsütéses nap vár ránk – a rák a tányérra való`,
  },
  layers: {
    name: 'Réteges öltözet',
    why: ({ spread }) => `Éjjel és nappal között akár ${spread} fok a különbség`,
  },
  wind: {
    name: 'Széldzseki',
    why: ({ maxWind }) => `Akár ${maxWind} km/h-s szél – a frizurának annyi`,
  },
};
