// The dictionary entry of "bódorgó" (shown by bodorgo-term): Hungarian for
// a browser set to Hungarian, English for everyone else.

export type EntryLang = 'hu' | 'en';

export interface BodorgoEntry {
  ipa: string;
  respell?: string;
  pos: string;
  aside?: string;
  // May contain <i> tags.
  etymology: string;
  senses: string[];
  examples: string[];
  oppositeLabel: string;
  opposite: string;
  sourcesTitle: string;
}

export const ENTRY_SOURCES = [
  'The Oxbridge Dictionary of Mild Wandering, 3rd ed., p. 404 (page not found)',
  'Cambridgeish English Dictionary, entry added after a lost bet',
  'Merriam-Wobbler’s Collegiate Dictionary, 11th pint',
  'The Concise Dictionary of Words Nobody Asked For (Budapest–Pomáz University Press, 2026)',
];

export const ENTRIES: Record<EntryLang, BodorgoEntry> = {
  en: {
    ipa: '/ˈboʊ.dor.ɡoʊ/',
    respell: 'BOH-dor-go',
    pos: 'noun [plural only, occurs once a year]',
    aside: 'Tourists’ attempt: “body-orgo.” Please don’t.',
    etymology:
      'From Hungarian <i>bódorog</i>, which linguists believe to be a merger of <i>to wander about</i> and <i>we’re in no hurry</i>. First recorded on the back of a hiking map, in pencil, illegibly.',
    senses: [
      'A person moving with no clear destination but great enthusiasm.',
      'A hiker who never gets lost, only takes alternative routes.',
      'A rare species living in groups; natural habitat is the stretch between the hiking trail and the nearest pub.',
    ],
    examples: [
      '“This isn’t a detour, it’s a bódorgás.”',
      '“Where are you?” – “Almost there.” (Two hours later.)',
      'A bódorgó’s tip for the final: confident and wrong.',
    ],
    oppositeLabel: 'Opposite:',
    opposite: 'timetable.',
    sourcesTitle: 'Sources',
  },
  hu: {
    ipa: '/ˈboːdorɡoː/',
    pos: 'főnév [csak többes számban fordul elő, évente egyszer]',
    etymology:
      'A <i>bódorog</i> igéből, amely a nyelvészek szerint a <i>bóklászik</i> és a <i>nem sietünk sehová</i> összeolvadásából keletkezett. Első írásos említése egy túratérkép hátoldalán, ceruzával, olvashatatlanul.',
    senses: [
      'Céltalanul, de nagy lelkesedéssel haladó személy.',
      'Olyan túrázó, aki soha nem téved el, csak alternatív útvonalat választ.',
      'Ritka, csoportosan élő faj; természetes élőhelye a turistaút és a legközelebbi vendéglő közötti szakasz.',
    ],
    examples: [
      '„Ez nem kitérő, ez bódorgás.”',
      '„Hol vagytok?” – „Mindjárt ott.” (Két óra múlva.)',
      'A bódorgó tippje a döntőre: magabiztos és téves.',
    ],
    oppositeLabel: 'Ellentéte:',
    opposite: 'menetrend.',
    sourcesTitle: 'Források',
  },
};

// Hungarian if the browser lists Hungarian among its languages at all,
// English otherwise. To see the other one, the address can say which:
// ?szotar=en or ?szotar=hu.
export function browserEntryLang(): EntryLang {
  const asked = new URLSearchParams(location.search).get('szotar');
  if (asked === 'hu' || asked === 'en') return asked;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith('hu')) ? 'hu' : 'en';
}
