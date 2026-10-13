import { fold } from '../pages/daloskonyv/search';

// The countries a tour can be in (Tour.location.country): the two-letter
// code, its Hungarian name, and the words the Táborok search finds it by.
// Hungary and its neighbourhood - a new one is one line here and one in
// the server's list (server/src/utils/countries.js).
export const COUNTRIES = [
  { code: 'HU', name: 'Magyarország', words: ['magyar'] },
  { code: 'SK', name: 'Szlovákia', words: ['szlovák'] },
  { code: 'PL', name: 'Lengyelország', words: ['lengyel'] },
  { code: 'RO', name: 'Románia', words: ['román'] },
  { code: 'AT', name: 'Ausztria', words: ['osztrák'] },
  { code: 'SI', name: 'Szlovénia', words: ['szlovén'] },
  { code: 'HR', name: 'Horvátország', words: ['horvát'] },
  { code: 'RS', name: 'Szerbia', words: ['szerb'] },
  { code: 'UA', name: 'Ukrajna', words: ['ukrán'] },
  { code: 'CZ', name: 'Csehország', words: ['cseh'] },
  { code: 'DE', name: 'Németország', words: ['német'] },
  { code: 'IT', name: 'Olaszország', words: ['olasz'] },
];

export const HOME_COUNTRY = 'HU';

const abroad = (country: string | undefined) =>
  COUNTRIES.find((c) => c.code === country && c.code !== HOME_COUNTRY);

// The address as it is shown: abroad, the country's code after it
// ("Vavrišovo 293, 032 42 Pribylina, SK"); in Hungary, as typed.
export function addressWithCountry(location: { address?: string; country?: string }): string {
  const address = (location.address ?? '').trim();
  return address && abroad(location.country) ? `${address}, ${location.country}` : address;
}

// Does a search (already folded - no capitals, no accents) find a tour by
// its country? Only a tour abroad. Part of the country's name or word is
// enough ("szlov", "lengyel"); the code only whole ("sk" - two letters are
// in too many words).
export function countryFound(country: string | undefined, search: string): boolean {
  const c = abroad(country);
  if (!c || !search) return false;
  return (
    search === fold(c.code) || [c.name, ...c.words].some((word) => fold(word).includes(search))
  );
}
