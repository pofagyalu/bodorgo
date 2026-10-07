import { describe, expect, it } from 'vitest';
import {
  buildWeatherOutlook,
  conditionScore,
  dayScore,
  packingList,
  temperatureScore,
  tierOf,
} from '../../src/utils/weatherOutlook.js';

const day = (over = {}) => ({
  condition: 'clear',
  tempDayC: 22,
  tempNightC: 14,
  windSpeedKmh: 10,
  rainChance: 0,
  isFinal: false,
  ...over,
});

// A tour starting on a Friday in October, its days numbered from 1.
const tour = (days, over = {}) => ({
  order: 12,
  startDate: new Date(2026, 9, 16),
  duration: days.length,
  dailyWeather: days.map((d, i) => ({ day: i + 1, ...d })),
  ...over,
});

const TODAY = new Date(2026, 9, 13, 15, 30);

describe('the scores', () => {
  it('judges the temperature against the month', () => {
    // 5 °C: a fine January day, a poor July one.
    expect(temperatureScore(5, 0)).toBe(100);
    expect(temperatureScore(5, 6)).toBe(0);
    // October: full marks 14-23, fading to nothing 13 under and 8 over.
    expect(temperatureScore(14, 9)).toBe(100);
    expect(temperatureScore(23, 9)).toBe(100);
    expect(temperatureScore(7.5, 9)).toBeCloseTo(50);
    expect(temperatureScore(27, 9)).toBeCloseTo(50);
    expect(temperatureScore(40, 9)).toBe(0);
  });

  it('forgives a wet day when the rain is not certain', () => {
    expect(conditionScore({ condition: 'clear', rainChance: 90 })).toBe(100);
    expect(conditionScore({ condition: 'rain', rainChance: 100 })).toBe(25);
    expect(conditionScore({ condition: 'rain', rainChance: 0 })).toBe(62.5);
    // No chance given: counted as 80%.
    expect(conditionScore({ condition: 'rain', rainChance: null })).toBeCloseTo(32.5);
  });

  it('mixes the kind of day and its temperature 60/40', () => {
    expect(dayScore(day(), 9)).toBe(100);
    expect(dayScore(day({ condition: 'cloudy', tempDayC: 7.5 }), 9)).toBeCloseTo(59);
  });

  it('sorts a score into its mood', () => {
    expect([100, 85, 84.9, 70, 50, 30, 29.9, 0].map(tierOf)).toEqual([
      'perfect',
      'perfect',
      'great',
      'great',
      'mixed',
      'gloomy',
      'rough',
      'rough',
    ]);
  });
});

describe('the packing list', () => {
  const icons = (days) => packingList(days).map((p) => p.icon);

  it('packs light for warm, calm, dry days', () => {
    expect(icons([day(), day({ tempDayC: 25, tempNightC: 15 })])).toEqual(['tshirt', 'sun']);
  });

  it('goes by the extremes of the whole tour', () => {
    const list = packingList([
      day({ tempDayC: 21, tempNightC: 13 }),
      day({ condition: 'rain', tempDayC: 9, tempNightC: -1, rainChance: 90 }),
      day({ condition: 'cloudy', tempDayC: 12, tempNightC: 7, windSpeedKmh: 45, rainChance: 50 }),
    ]);
    expect(list.map((p) => p.icon)).toEqual([
      'tshirt',
      'sweater',
      'jacket',
      'beanie',
      'umbrella',
      'wind',
    ]);
    const why = Object.fromEntries(list.map((p) => [p.icon, p.why]));
    expect(why.tshirt).toContain('21 °C');
    expect(why.beanie).toContain('-1 °C');
    // The rainy day, and the cloudy one with a 50% chance.
    expect(why.umbrella).toMatch(/^2 napon/);
    expect(why.wind).toContain('45 km/h');
  });

  it('asks for layers when night and day are far apart', () => {
    expect(icons([day({ tempDayC: 24, tempNightC: 11 })])).toEqual([
      'tshirt',
      'sweater',
      'sun',
      'layers',
    ]);
  });
});

describe('the outlook of a tour', () => {
  it('needs a forecast for every day', () => {
    expect(buildWeatherOutlook(tour([day(), day()], { duration: 3 }), TODAY)).toBeNull();
    expect(buildWeatherOutlook(tour([]), TODAY)).toBeNull();
    // Recorded weather is no forecast.
    expect(buildWeatherOutlook(tour([day({ isFinal: true }), day()]), TODAY)).toBeNull();
  });

  it('is perfect when every day is', () => {
    const outlook = buildWeatherOutlook(tour([day(), day(), day()]), TODAY);
    expect(outlook).toMatchObject({
      score: 100,
      tier: 'perfect',
      tag: 'Napszemüveges idő',
      word: 'Álomszép',
      lines: ['Minden nap jónak ígérkezik. Gyanúsan jónak.'],
      note: null,
    });
    expect(outlook.days.map((d) => d.score)).toEqual([100, 100, 100]);
    expect(outlook.days[0]).not.toHaveProperty('weekday');
  });

  it('lets one bad day pull it down, and names it and the best day', () => {
    const outlook = buildWeatherOutlook(
      tour([
        day(),
        day({ condition: 'thunderstorm', tempDayC: 9, tempNightC: 4, rainChance: 100 }),
        day({ condition: 'partly-cloudy' }),
        day(),
      ]),
      TODAY,
    );
    // Days 100, 30.6, 91, 100: 0.7 x average + 0.3 x worst.
    expect(outlook.days[1].score).toBeCloseTo(30.6);
    expect(outlook.score).toBeCloseTo(65.5);
    expect(outlook.tier).toBe('mixed');
    // Sunday beats Friday and Monday only because those are the arrival
    // and the leaving day - nothing is ever proposed for them.
    expect(outlook.lines).toEqual([
      'A leggyengébb napnak a szombat ígérkezik: zivatar, 4 és 9 °C között.',
      'A nagy túrát vasárnapra érdemes időzíteni.',
    ]);
  });

  it('proposes no day for the big outing when there is no full day', () => {
    const stormy = day({ condition: 'thunderstorm', tempDayC: 9, tempNightC: 4, rainChance: 100 });
    expect(buildWeatherOutlook(tour([day(), stormy]), TODAY).lines).toHaveLength(1);
    // Nor when the only full day is the weakest one.
    expect(buildWeatherOutlook(tour([day(), stormy, day()]), TODAY).lines).toHaveLength(1);
  });

  it('calls itself an early guess while the start is far off', () => {
    const days = [day(), day()];
    expect(buildWeatherOutlook(tour(days), new Date(2026, 9, 11)).note).toBeNull();
    expect(buildWeatherOutlook(tour(days), new Date(2026, 9, 10)).note).toContain('korai jóslat');
  });

  it('changes its headline from day to day', () => {
    const days = [day(), day()];
    const headline = (date) => buildWeatherOutlook(tour(days), date).headline;
    expect(headline(new Date(2026, 9, 13))).toBe(headline(new Date(2026, 9, 13, 23)));
    expect(headline(new Date(2026, 9, 13))).not.toBe(headline(new Date(2026, 9, 14)));
  });
});
