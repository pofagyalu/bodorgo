import { describe, expect, it } from 'vitest';
import { computeSunDays, SUN_MOMENTS } from '../../src/utils/sunDays.js';

// The tour days are local midnights (Budapest), the times instants - shown
// here in the place's own zone, to the minute.
const at = (date, timeZone = 'Europe/Budapest') =>
  date.toLocaleTimeString('hu-HU', { timeZone, hour: '2-digit', minute: '2-digit' });

const matrahaza = { type: 'Point', coordinates: [19.97, 47.87] };

describe('computeSunDays', () => {
  it('gives every tour day its moments, in the order of the day', () => {
    const days = computeSunDays({
      startDate: new Date('2027-07-10T00:00:00+02:00'),
      duration: 3,
      location: matrahaza,
    });
    expect(days.map((d) => d.day)).toEqual([1, 2, 3]);
    for (const day of days) {
      const times = SUN_MOMENTS.map(([name]) => day[name].getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
    // A summer day in the Mátra (checked against PhotoPills, to a minute).
    expect(at(days[0].sunrise)).toBe('04:51');
    expect(at(days[0].sunset)).toBe('20:38');
    expect(at(days[0].nightEnd)).toBe('01:57');
    expect(at(days[0].night)).toBe('23:31');
    // Each day is its own calendar day.
    expect(days[2].sunrise.getTime() - days[0].sunrise.getTime()).toBeGreaterThan(
      47 * 60 * 60 * 1000,
    );
  });

  it('blue hour is -6° to -4°, golden hour -4° to +6° around the horizon', () => {
    const [day] = computeSunDays({
      startDate: new Date('2027-07-10T00:00:00+02:00'),
      duration: 1,
      location: matrahaza,
    });
    const minutes = (from, to) => (day[to] - day[from]) / 60000;
    expect(minutes('blueHourStart', 'goldenHourStart')).toBeGreaterThan(10);
    expect(minutes('blueHourStart', 'goldenHourStart')).toBeLessThan(25);
    expect(minutes('goldenHourStart', 'dayStart')).toBeGreaterThan(55);
    expect(minutes('blueHour', 'blueHourEnd')).toBeGreaterThan(10);
  });

  it('a winter day abroad, in its own zone', () => {
    // Brassó, 21 December: an hour ahead of Budapest.
    const [day] = computeSunDays({
      startDate: new Date('2026-12-21T00:00:00+01:00'),
      duration: 1,
      location: { type: 'Point', coordinates: [25.6, 45.65] },
    });
    expect(at(day.sunrise, 'Europe/Bucharest')).toBe('07:55');
    expect(at(day.sunset, 'Europe/Bucharest')).toBe('16:36');
  });

  it('nothing without a place', () => {
    expect(computeSunDays({ startDate: new Date(), duration: 2, location: {} })).toEqual([]);
    expect(
      computeSunDays({ startDate: new Date(), duration: 2, location: { coordinates: [] } }),
    ).toEqual([]);
  });
});
