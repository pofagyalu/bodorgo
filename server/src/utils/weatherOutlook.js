import { MAX_FORECAST_DAYS_AHEAD, WEATHER_REFETCH_HOURS } from './weather.js';
import { OUTLOOK_SETTINGS as S } from './weatherOutlookSettings.js';
import { CONDITION_TEXTS, LINE_TEXTS, PACK_TEXTS, TIER_TEXTS } from './weatherOutlookTexts.js';

// Everything the outlook is worked out from, as it stands in the code -
// for Klub → Beállítások → Infó, which explains the formula with these
// very numbers (GET /settings/weather-outlook), so the page can never say
// something else than what the app does.
export function weatherOutlookRules() {
  const order = ['rough', 'gloomy', 'mixed', 'great', 'perfect'];
  const from = { rough: 0, ...S.tiers };
  return {
    forecast: { daysAhead: MAX_FORECAST_DAYS_AHEAD, refetchHours: WEATHER_REFETCH_HOURS },
    settings: S,
    // The moods, worst first, each with the stretch of the index it covers.
    tiers: order.map((tier, i) => ({
      tier,
      from: from[tier],
      to: i < order.length - 1 ? from[order[i + 1]] : 100,
      tag: TIER_TEXTS[tier].tag,
      word: TIER_TEXTS[tier].word,
    })),
    conditionNames: CONDITION_TEXTS,
    packNames: Object.fromEntries(Object.entries(PACK_TEXTS).map(([icon, t]) => [icon, t.name])),
  };
}

// A tour's weather outlook ("Életviteli tanácsok" on the tour page, the
// pill on the tour list, a block in the Programfüzet): one mood for the
// whole tour and what to pack for it, worked out from the forecast of its
// days. The numbers live in weatherOutlookSettings.js, the words in
// weatherOutlookTexts.js; tourController.js's refreshTourWeather decides
// when it is built and when it freezes.

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (v) => Math.max(0, Math.min(100, v));
const round1 = (v) => Math.round(v * 10) / 10;

// The date's own calendar day (server local time), like the tour days in
// refreshTourWeather.
function midnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateOfDay(tour, day) {
  const d = midnight(tour.startDate);
  d.setDate(d.getDate() + (day - 1));
  return d;
}

// How comfortable the daytime temperature is for that month (0 = January).
export function temperatureScore(maxC, month) {
  const [low, high] = S.comfortByMonth[month];
  if (maxC >= low && maxC <= high) return 100;
  return maxC < low
    ? clamp((1 - (low - maxC) / S.comfortFadeBelow) * 100)
    : clamp((1 - (maxC - high) / S.comfortFadeAbove) * 100);
}

export function conditionScore({ condition, rainChance }) {
  const base = S.conditionScore[condition];
  if (!S.wetConditions.includes(condition)) return base;
  const chance = (rainChance ?? S.defaultRainChance) / 100;
  return base + (100 - base) * (1 - chance) * S.rainChanceSoftening;
}

export function dayScore(day, month) {
  return (
    S.weights.condition * conditionScore(day) +
    S.weights.temperature * temperatureScore(day.tempDayC, month)
  );
}

export function tierOf(score) {
  if (score >= S.tiers.perfect) return 'perfect';
  if (score >= S.tiers.great) return 'great';
  if (score >= S.tiers.mixed) return 'mixed';
  if (score >= S.tiers.gloomy) return 'gloomy';
  return 'rough';
}

const isWet = (d) =>
  S.wetConditions.includes(d.condition) || (d.rainChance ?? 0) >= S.wetRainChance;

// Mit pakoljunk? - from the extremes of the days, with the reason for each.
export function packingList(days) {
  const P = S.packing;
  const facts = {
    minLow: Math.min(...days.map((d) => d.tempNightC)),
    maxHigh: Math.max(...days.map((d) => d.tempDayC)),
    wetDays: days.filter(isWet).length,
    sunDays: days.filter(
      (d) => S.sunnyConditions.includes(d.condition) && d.tempDayC >= P.sunnyDayFromMaxC,
    ).length,
    spread: Math.max(...days.map((d) => d.tempDayC - d.tempNightC)),
    maxWind: Math.max(...days.map((d) => d.windSpeedKmh ?? 0)),
  };

  const wanted = [
    ['tshirt', facts.maxHigh >= P.tshirtFromMaxC],
    ['sweater', facts.minLow < P.sweaterBelowMinC],
    ['jacket', facts.minLow < P.jacketBelowMinC],
    ['beanie', facts.minLow <= P.beanieFromMinC],
    ['umbrella', facts.wetDays > 0],
    ['wind', facts.maxWind >= P.windFromKmh],
    ['sun', facts.sunDays > 0 && facts.maxHigh >= P.sunFromMaxC],
    ['layers', facts.spread >= P.layersFromSpreadC],
  ];
  return wanted
    .filter(([, needed]) => needed)
    .map(([icon]) => ({ icon, name: PACK_TEXTS[icon].name, why: PACK_TEXTS[icon].why(facts) }));
}

// The outlook as it stands today, or null while even one day of the tour
// has no forecast yet (a day already replaced by its recorded weather is
// no forecast either - the outlook is never made up afterwards).
export function buildWeatherOutlook(tour, today = new Date()) {
  const days = [];
  for (let day = 1; day <= tour.duration; day++) {
    const w = (tour.dailyWeather || []).find((entry) => entry.day === day);
    if (!w || w.isFinal || !w.condition || w.tempDayC == null || w.tempNightC == null) return null;
    const date = dateOfDay(tour, day);
    const forecast = {
      day,
      condition: w.condition,
      tempDayC: w.tempDayC,
      tempNightC: w.tempNightC,
      windSpeedKmh: w.windSpeedKmh ?? null,
      rainChance: w.rainChance ?? null,
    };
    days.push({
      ...forecast,
      score: round1(dayScore(forecast, date.getMonth())),
      weekday: date.getDay(),
    });
  }
  if (!days.length) return null;

  const average = days.reduce((sum, d) => sum + d.score, 0) / days.length;
  const worst = days.reduce((a, d) => (d.score < a.score ? d : a));
  // The big outing is only ever proposed for a full day: people arrive
  // through the first day and leave on the last.
  const fullDays = days.slice(1, -1);
  const best = fullDays.length ? fullDays.reduce((a, d) => (d.score > a.score ? d : a)) : null;
  const score = round1(S.weights.average * average + S.weights.worstDay * worst.score);
  const tier = tierOf(score);

  const lines = [];
  if (worst.score >= S.allGoodFrom) {
    lines.push(LINE_TEXTS.allGood);
  } else {
    lines.push(
      LINE_TEXTS.worstDay(worst.weekday, worst.condition, worst.tempNightC, worst.tempDayC),
    );
    if (best && best.score - worst.score > S.bestDayLead) {
      lines.push(LINE_TEXTS.bestDay(best.weekday));
    }
  }

  const todayMidnight = midnight(today);
  const daysUntil = Math.round((midnight(tour.startDate) - todayMidnight) / DAY_MS);
  // A different headline each day, and not the same one on every tour.
  const { tag, word, headlines } = TIER_TEXTS[tier];
  const turn = Math.floor(todayMidnight.getTime() / DAY_MS) + (tour.order ?? 0);

  return {
    score,
    tier,
    tag,
    word,
    headline: headlines[Math.abs(turn) % headlines.length],
    lines,
    // An early guess while the start is still far off - said out loud.
    note: daysUntil > S.uncertainAfterDays ? LINE_TEXTS.uncertain : null,
    pack: packingList(days),
    days: days.map(({ weekday, ...d }) => d),
  };
}
