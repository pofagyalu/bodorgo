import { ComponentFixture, TestBed } from '@angular/core/testing';

import { makeTour } from '../../../../testing/fixtures';
import { SunDay, Tour } from '../../../services/tour';
import { TourSunDay } from './tour-sun-day';

// One summer day in the Mátra, its moments at Budapest summer time (+02:00).
function sunDay(day: number, date: string, sunset = '20:38'): SunDay {
  const at = (time: string) => new Date(`${date}T${time}:00+02:00`).toISOString();
  return {
    day,
    nightEnd: at('01:57'),
    blueHourStart: at('04:11'),
    goldenHourStart: at('04:27'),
    sunrise: at('04:51'),
    dayStart: at('05:39'),
    goldenHour: at('19:51'),
    sunset: at(sunset),
    blueHour: at('21:02'),
    blueHourEnd: at('21:18'),
    night: at('23:31'),
  };
}

const twoDays = [sunDay(1, '2027-07-10'), sunDay(2, '2027-07-11', '20:36')];

describe('TourSunDay', () => {
  let fixture: ComponentFixture<TourSunDay>;
  let el: HTMLElement;

  function show(tour: Tour) {
    fixture = TestBed.createComponent(TourSunDay);
    fixture.componentRef.setInput('tour', tour);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  // The words of each match - the icons' names (Material Icons ligatures) left out.
  const text = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => {
      const copy = node.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.material-icons').forEach((icon) => icon.remove());
      return copy.textContent!.replace(/\s+/g, ' ').trim();
    });

  afterEach(() => vi.useRealTimers());

  it('is not there at all without the times', () => {
    show(makeTour());
    expect(el.textContent!.trim()).toBe('');
  });

  it('shows the nine moments of the first day in local time', () => {
    show(makeTour({ sunDays: twoDays }));
    expect(text('.section-heading')).toEqual(['Az idő járása']);
    expect(text('.sky-date')).toEqual(['2027. július 10., szombat']);
    expect(text('.moment-name')).toEqual([
      'Éjszaka vége',
      'Kékóra',
      'Aranyóra',
      'Napkelte',
      'Nappal',
      'Aranyóra',
      'Napnyugta',
      'Kékóra',
      'Éjszaka',
    ]);
    expect(text('.moment-time')).toEqual([
      '01:57',
      '04:11',
      '04:27',
      '04:51',
      '05:39',
      '19:51',
      '20:38',
      '21:02',
      '23:31',
    ]);
    expect(text('.sky-daylight')).toEqual(['15 ó 47 p napfény']);
    // Not today: the big sun shows the daylight, no "now" on the line.
    expect(text('.sky-info strong')).toEqual(['Nappal']);
    expect(el.querySelector('.sky-now')).toBeNull();
    expect(el.querySelector('.now-dot')).toBeNull();
    expect(el.querySelectorAll('.moment-dot--small').length).toBe(2);
  });

  it('steps to the next day, and tells how much shorter it is', () => {
    show(makeTour({ sunDays: twoDays }));
    const [prev, next] = el.querySelectorAll<HTMLButtonElement>('.sky-arrow');
    expect(prev.disabled).toBe(true);
    next.click();
    fixture.detectChanges();
    expect(text('.sky-date')).toEqual(['2027. július 11., vasárnap']);
    expect(text('.sky-daylight')).toEqual([
      '15 ó 45 p napfény · 2 perccel kevesebb, mint előző nap',
    ]);
    expect(next.disabled).toBe(true);
  });

  it('a tapped moment goes into the big sun', () => {
    show(makeTour({ sunDays: twoDays }));
    el.querySelectorAll<HTMLButtonElement>('.moment')[7].click();
    fixture.detectChanges();
    expect(text('.sky-info strong')).toEqual(['Kékóra']);
    expect(text('.sky-info em')).toEqual(['A fotósok most nem esznek']);
    expect(el.querySelector('.big-sun')!.classList).toContain('big-sun--blue');
  });

  it('on a tour day that is today it shows where the sun is now', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-07-11T20:00:00+02:00'));
    show(makeTour({ sunDays: twoDays }));
    // Opens on today, the second day.
    expect(text('.sky-date')).toEqual(['2027. július 11., vasárnap']);
    expect(text('.sky-info strong')).toEqual(['Aranyóra']);
    expect(text('.sky-now')).toEqual(['most · 20:00']);
    // In the stretch from the evening Aranyóra (19:51) to sunset (20:36).
    const stretches = el.querySelectorAll('.stretch');
    expect(stretches[5].classList).toContain('stretch--now');
    expect(stretches[4].classList).not.toContain('stretch--ahead');
    expect(stretches[6].classList).toContain('stretch--ahead');
    const now = el.querySelector<HTMLElement>('.now-dot')!;
    expect(Number(now.style.getPropertyValue('--f'))).toBeCloseTo(9 / 45, 2);
  });

  it('shows a tour in Romania in Romanian time', () => {
    show(makeTour({ sunDays: twoDays, location: { ...makeTour().location, country: 'RO' } }));
    expect(text('.moment-time')[3]).toBe('05:51'); // sunrise
  });
});
