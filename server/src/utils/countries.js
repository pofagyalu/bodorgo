// The countries a tour can be in (tourModel.js's location.country): the
// two-letter code, and its Hungarian name. Hungary and its neighbourhood -
// a new one is one line here and one in the client's list
// (client/src/app/shared/countries.ts).
export const COUNTRIES = {
  HU: 'Magyarország',
  SK: 'Szlovákia',
  PL: 'Lengyelország',
  RO: 'Románia',
  AT: 'Ausztria',
  SI: 'Szlovénia',
  HR: 'Horvátország',
  RS: 'Szerbia',
  UA: 'Ukrajna',
  CZ: 'Csehország',
  DE: 'Németország',
  IT: 'Olaszország',
};

export const COUNTRY_CODES = Object.keys(COUNTRIES);
export const HOME_COUNTRY = 'HU';

// The code an address written the old way ends with - "…, SK" or
// "…, Szlovákia" - or null. Tours had no country field before 2026-10-13;
// a beszámoló frozen before then still holds its address like that.
export function countryAtEndOf(address) {
  const last = (address ?? '').split(',').pop().trim().toLowerCase();
  return (
    COUNTRY_CODES.find(
      (code) =>
        code !== HOME_COUNTRY &&
        (code.toLowerCase() === last || COUNTRIES[code].toLowerCase() === last),
    ) ?? null
  );
}

// A tour's country code, from its location.
export const countryOf = (location) =>
  COUNTRY_CODES.includes(location?.country) && location.country !== HOME_COUNTRY
    ? location.country
    : (countryAtEndOf(location?.address) ?? HOME_COUNTRY);

// The address as it is shown: abroad, the country's code after it
// ("Vavrišovo 293, 032 42 Pribylina, SK"); in Hungary, as typed.
export function addressWithCountry(location) {
  const address = (location?.address ?? '').trim();
  const country = location?.country;
  if (!address || !COUNTRY_CODES.includes(country) || country === HOME_COUNTRY) return address;
  return `${address}, ${country}`;
}
