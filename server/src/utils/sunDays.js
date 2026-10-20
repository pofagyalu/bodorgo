import { addTime, getTimes } from 'suncalc';

// "Az idő járása" on the tour page (tour-sun-day): where the sun is on each
// day of the tour - computed once by suncalc and kept on the tour
// (tourModel.js's sunDays), redone only when the dates or the place change.
// The moments, as PhotoPills counts them: blue hour is the sun between -6°
// and -4°, golden hour between -4° and +6°, night below -18°. suncalc knows
// all of them but -4°, added here once.
addTime(-4, 'morningGoldenHour', 'blueHour');

// What is kept of suncalc's answer, in the day's order: [our name, suncalc's].
// The gap between nightEnd and blueHourStart (and between blueHourEnd and
// night) is the darker twilight - drawn, never labelled.
export const SUN_MOMENTS = [
  ['nightEnd', 'nightEnd'], // -18°, morning: night is over
  ['blueHourStart', 'dawn'], // -6°
  ['goldenHourStart', 'morningGoldenHour'], // -4°
  ['sunrise', 'sunrise'], // 0°
  ['dayStart', 'goldenHourEnd'], // +6°: daylight
  ['goldenHour', 'goldenHour'], // +6°, evening
  ['sunset', 'sunset'], // 0°
  ['blueHour', 'blueHour'], // -4°
  ['blueHourEnd', 'dusk'], // -6°
  ['night', 'night'], // -18°
];

// One entry per tour day (1-indexed, like the schedule's day), the moments
// as instants - the page shows them in the place's own time zone. The tour
// days are local midnights (see tourController.js's toDateStr): asked at
// that day's noon, suncalc gives the solar day around it, which is that
// calendar day everywhere a tour goes. [] without a place.
export function computeSunDays({ startDate, duration, location }) {
  const coords = location?.coordinates;
  if (!startDate || !duration || coords?.length !== 2 || coords.some((c) => c == null)) return [];
  const [lng, lat] = coords;

  return Array.from({ length: duration }, (_, i) => {
    const noon = new Date(startDate);
    noon.setDate(noon.getDate() + i);
    noon.setHours(12, 0, 0, 0);
    const times = getTimes(noon, lat, lng);
    return {
      day: i + 1,
      ...Object.fromEntries(SUN_MOMENTS.map(([ours, theirs]) => [ours, times[theirs] ?? null])),
    };
  });
}
