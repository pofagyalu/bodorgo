import { afterEach, describe, expect, it } from 'vitest';
import { tourCourseWindow } from '../../src/futokor/tourWindow.js';

const tour = {
  startDate: new Date('2026-10-22T12:00:00Z'),
  duration: 4,
  location: { country: 'SK', coordinates: [19.7643, 49.0684] },
};

describe('tourCourseWindow', () => {
  const RealFormat = Intl.DateTimeFormat;
  afterEach(() => {
    Intl.DateTimeFormat = RealFormat;
  });

  it('opens at 10:00 on the first day, closes at sunset the day before the last', () => {
    const { opensAt, closesAt } = tourCourseWindow(tour);
    expect(opensAt.toISOString()).toBe('2026-10-22T08:00:00.000Z');
    expect(closesAt.toISOString().slice(0, 13)).toBe('2026-10-24T15');
  });

  // The live server's Node has only English locale data: every locale
  // answers as 'en-US' there (an edit of tatrai-osz failed on it).
  it('works with English locale data only', () => {
    Intl.DateTimeFormat = function (_locale, options) {
      return new RealFormat('en-US', options);
    };
    expect(tourCourseWindow(tour).opensAt.toISOString()).toBe('2026-10-22T08:00:00.000Z');
  });
});
