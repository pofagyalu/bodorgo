import { countryOf, timeZoneOf } from '../utils/countries.js';
import { computeSunDays } from '../utils/sunDays.js';

// When a tour's course is open - never set by hand, always from the tour:
// from 10:00 on its first day (the place's own time) until sunset on the
// day before its last (a one-day tour: that day's sunset). The sunset is
// the tour's own sun times (sunDays, Az idő járása). Without a place there
// is no sunset: closesAt is null then.
export const OPENS_AT_HOUR = 10;

// How far a zone's clock is ahead of UTC at an instant (ms).
function zoneOffset(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

// The instant a zone's clock shows `hour`:00 on a calendar day ("2026-10-22").
export function atLocalHour(day, hour, timeZone) {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  // Twice: the first guess may sit on the other side of a clock change.
  let at = wall - zoneOffset(wall, timeZone);
  at = wall - zoneOffset(at, timeZone);
  return new Date(at);
}

export function tourCourseWindow(tour) {
  const timeZone = timeZoneOf(countryOf(tour.location));
  // Its first day on the place's own calendar ("2026-10-22") - by the zone's
  // offset, not the 'en-CA' formatting trick: the live server's Node has
  // only English locale data, where that gives "10/22/2026" (utils/huDate.js).
  const start = new Date(tour.startDate).getTime();
  const firstDay = new Date(start + zoneOffset(start, timeZone)).toISOString().slice(0, 10);
  const sunDays = tour.sunDays?.length ? tour.sunDays : computeSunDays(tour);
  const closingDay = sunDays[Math.max((tour.duration ?? 1) - 2, 0)];
  return {
    opensAt: atLocalHour(firstDay, OPENS_AT_HOUR, timeZone),
    closesAt: closingDay?.sunset ? new Date(closingDay.sunset) : null,
  };
}
