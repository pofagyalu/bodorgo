// Every number behind a tour's weather outlook ("Életviteli tanácsok" - see
// weatherOutlook.js) in one place, so the formula can be retuned without
// touching the logic. Nothing here is serious science.

export const OUTLOOK_SETTINGS = {
  // How good each kind of day is on its own, 0-100 (the app's own seven
  // conditions - see weather.js's classifyDay).
  conditionScore: {
    clear: 100,
    'partly-cloudy': 85,
    cloudy: 65,
    fog: 50,
    snow: 35,
    rain: 25,
    thunderstorm: 10,
  },

  // The kinds that count as a wet day.
  wetConditions: ['rain', 'snow', 'thunderstorm'],
  // The kinds that count as a sunny day.
  sunnyConditions: ['clear', 'partly-cloudy'],

  // A wet day is forgiven a little when the rain isn't certain:
  //   score = base + (100 - base) x (1 - chance) x rainChanceSoftening
  // No chance given by the forecast counts as defaultRainChance.
  rainChanceSoftening: 0.5,
  defaultRainChance: 80,
  // From this chance of rain a day needs an umbrella, whatever its kind.
  wetRainChance: 40,

  // The daytime temperature that feels just right, month by month (January
  // first) - a tour is judged against its own season, so a crisp sunny
  // winter day can still be a great one. Full marks between [low, high],
  // falling evenly to nothing comfortFadeBelow degrees under the range and
  // comfortFadeAbove degrees over it.
  comfortByMonth: [
    [3, 12], // január
    [5, 14], // február
    [10, 20], // március
    [15, 24], // április
    [18, 25], // május
    [20, 27], // június
    [21, 28], // július
    [21, 28], // augusztus
    [18, 25], // szeptember
    [14, 23], // október
    [8, 18], // november
    [3, 12], // december
  ],
  comfortFadeBelow: 13,
  comfortFadeAbove: 8,

  // A day's score = its kind and its temperature, in these shares; the
  // tour's = the average of its days and its worst day, so one bad day
  // still pulls it down.
  weights: { condition: 0.6, temperature: 0.4, average: 0.7, worstDay: 0.3 },

  // The score each mood starts from; anything under `gloomy` is rough.
  tiers: { perfect: 85, great: 70, mixed: 50, gloomy: 30 },

  // Further out than this many days the outlook is marked an early guess.
  uncertainAfterDays: 5,

  // "Every day looks good" from this worst-day score; the best day
  // (never the arrival or the leaving day) is only named when it beats the
  // worst by more than bestDayLead.
  allGoodFrom: 85,
  bestDayLead: 10,

  // Mit pakoljunk? - decided from the extremes of the tour, never averages.
  packing: {
    tshirtFromMaxC: 20, // warmest day at least this
    sweaterBelowMinC: 12, // coldest night under this
    jacketBelowMinC: 6,
    beanieFromMinC: 0, // coldest night at or under this
    sunFromMaxC: 22, // warmest day at least this, with a sunny day...
    sunnyDayFromMaxC: 20, // ...which is a sunny kind of day at least this warm
    layersFromSpreadC: 12, // a day whose night and day differ by this much
    windFromKmh: 30, // the windiest day at least this
  },
};
