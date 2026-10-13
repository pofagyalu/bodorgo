import { tourDay } from './huDate.js';
import { fetchHistorical } from './weather.js';
import { dayScore, tierOf } from './weatherOutlook.js';
import { TIER_TEXTS } from './weatherOutlookTexts.js';

// What the weather was like on a day of a tour, for its beszámoló - the
// PDF's day headings and the JSON an AI model gets (tourReportController.js,
// tourReportJsonController.js). Only the recorded weather: a forecast is
// not what happened.

// A day's kind in a word, as the beszámoló says it.
export const CONDITION_WORDS = {
  clear: 'napos',
  'partly-cloudy': 'részben felhős',
  cloudy: 'felhős',
  fog: 'köd',
  rain: 'eső',
  snow: 'hó',
  thunderstorm: 'zivatar',
};

// The rain of the tour's past days, for the ones frozen before it was
// kept (tourModel.js's dailyWeather): asked from the archive once, and
// stored. A day the archive doesn't answer for stays without.
export async function ensureRecordedRain(tour) {
  const [lng, lat] = tour.location?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const missing = (tour.dailyWeather ?? []).filter((w) => w.isFinal && w.precipitationMm == null);
  if (!missing.length) return;
  let found = false;
  await Promise.all(
    missing.map(async (w) => {
      const recorded = await fetchHistorical(lat, lng, tourDay(tour.startDate, w.day - 1).ymd);
      if (recorded?.precipitationMm == null) return;
      w.precipitationMm = recorded.precipitationMm;
      w.precipitationHours = recorded.precipitationHours;
      found = true;
    }),
  );
  if (found) await tour.save();
}

// A day of the tour (dayIndex 0 = the first): { weather, wellbeing } -
// both null while the day has no recorded weather. wellbeing: the
// Jóléti-index of the day as it turned out (the Életviteli tanácsok's own
// formula, on the recorded weather) and its word, Pálinkás … Koktélos -
// only on a tour that had an Életviteli tanácsok (its weatherOutlook): an
// older tour's days say just what the weather was like.
export function recordedDay(tour, dayIndex) {
  const recorded = (tour.dailyWeather ?? []).find((w) => w.day === dayIndex + 1 && w.isFinal);
  if (!recorded) return { weather: null, wellbeing: null };
  const weather = {
    condition: recorded.condition ?? null,
    tempDayC: recorded.tempDayC ?? null,
    tempNightC: recorded.tempNightC ?? null,
    windSpeedKmh: recorded.windSpeedKmh ?? null,
    precipitationMm: recorded.precipitationMm ?? null,
    precipitationHours: recorded.precipitationHours ?? null,
  };
  if (tour.weatherOutlook?.score == null || !weather.condition || weather.tempDayC == null) {
    return { weather, wellbeing: null };
  }
  const month = Number(tourDay(tour.startDate, dayIndex).ymd.slice(5, 7)) - 1;
  const index = Math.round(dayScore(weather, month));
  return { weather, wellbeing: { index, word: TIER_TEXTS[tierOf(index)].word } };
}

// "2,6 mm eső (8 órán át)" - nothing for a dry day.
export function rainText(weather) {
  if (!weather?.precipitationMm) return null;
  const what = weather.condition === 'snow' ? 'csapadék' : 'eső';
  const hours = weather.precipitationHours ? ` (${weather.precipitationHours} órán át)` : '';
  return `${String(weather.precipitationMm).replace('.', ',')} mm ${what}${hours}`;
}
