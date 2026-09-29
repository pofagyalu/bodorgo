import { describe, expect, it } from 'vitest';
import {
  budapestParts,
  budapestYmd,
  huDate,
  huDateTime,
  huDateWeekday,
  huTime,
} from '../../src/utils/huDate.js';

// Hungarian dates written out by the app itself - the live server's Node
// has only English locale data (see utils/huDate.js).
describe('huDate', () => {
  it('writes Hungarian dates, with the day name', () => {
    const d = new Date('2026-10-22T10:00:00Z');
    expect(huDate(d)).toBe('2026. október 22.');
    expect(huDateWeekday(d)).toBe('2026. október 22., csütörtök');
    expect(huDateWeekday(new Date('2026-10-25T10:00:00Z'))).toBe('2026. október 25., vasárnap');
    expect(huDateTime(new Date('2026-09-29T12:05:00Z'))).toBe('2026. szeptember 29. 14:05');
  });

  it('counts in Budapest time - summer and winter, around midnight', () => {
    // 22:30 UTC in summer is already the next day in Budapest (UTC+2)...
    expect(budapestYmd(new Date('2026-07-31T22:30:00Z'))).toBe('2026-08-01');
    expect(huTime(new Date('2026-07-31T22:30:00Z'))).toBe('00:30');
    // ...in winter (UTC+1) only from 23:00.
    expect(budapestYmd(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
    expect(budapestParts(new Date('2026-12-31T23:10:00Z'))).toMatchObject({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 10,
      weekday: 5, // péntek
    });
  });
});
