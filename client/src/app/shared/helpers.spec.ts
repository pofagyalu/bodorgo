import { HttpErrorResponse } from '@angular/common/http';

import { downloadIcs, googleCalendarUrl, icsContent } from './calendar-event';
import { errorMessage } from './errors';
import { formatDrivingDuration, formatForint } from './format';
import { cssColor, pageFont, prefersReducedMotion } from './charts';
import { shuffledLogoColors } from './logo-colors';
import { PHOTO_WIDTHS, photoSlide } from './photo-sizes';
import { checkerTransparentPngs } from './pswp-checker';
import { usernameKey } from './usernames';

describe('errorMessage', () => {
  it("shows the server's own message", () => {
    const err = new HttpErrorResponse({ status: 400, error: { message: 'Betelt a tábor.' } });
    expect(errorMessage(err, 'Hiba')).toBe('Betelt a tábor.');
  });

  it('falls back when the server gave none', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 500, error: null }), 'Hiba')).toBe('Hiba');
    expect(
      errorMessage(new HttpErrorResponse({ status: 500, error: { message: '' } }), 'Hiba'),
    ).toBe('Hiba');
    expect(
      errorMessage(new HttpErrorResponse({ status: 500, error: { message: 7 } }), 'Hiba'),
    ).toBe('Hiba');
  });

  it('shows the message of an ordinary error', () => {
    expect(errorMessage(new Error('Túl nagy a kép.'), 'Hiba')).toBe('Túl nagy a kép.');
  });

  it('falls back for anything else', () => {
    expect(errorMessage('valami', 'Hiba')).toBe('Hiba');
    expect(errorMessage(null, 'Hiba')).toBe('Hiba');
    expect(errorMessage(new Error(''), 'Hiba')).toBe('Hiba');
  });
});

describe('formatForint', () => {
  it.each([
    [null, ''],
    [0, '0'],
    [999, '999'],
    [1000, '1 000'],
    [1234567, '1 234 567'],
    [-45000, '-45 000'],
    [1999.6, '2 000'],
  ])('%s is "%s"', (amount, text) => {
    expect(formatForint(amount)).toBe(text);
  });
});

describe('formatDrivingDuration', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    [45, 'kb. 45p'],
    [120, 'kb. 2ó'],
    [135, 'kb. 2ó 15p'],
  ])('%s minutes is "%s"', (minutes, text) => {
    expect(formatDrivingDuration(minutes)).toBe(text);
  });
});

describe('usernameKey', () => {
  it('ignores case and accents, so "Árvíztűrő" and "arvizturo" are the same name', () => {
    expect(usernameKey('Árvíztűrő')).toBe('arvizturo');
    expect(usernameKey('BODRI')).toBe(usernameKey('bodri'));
  });
});

describe('photoSlide', () => {
  it('offers every size up to the first one that covers the photo', () => {
    const slide = photoSlide('/p/a.jpg', '/p/a.jpg/thumb', { width: 1000, height: 750 }, 'a.jpg');
    expect(slide).toEqual({
      src: '/p/a.jpg?w=1200',
      srcset: '/p/a.jpg?w=800 800w, /p/a.jpg?w=1200 1000w',
      msrc: '/p/a.jpg/thumb',
      width: 1000,
      height: 750,
      alt: 'a.jpg',
    });
  });

  it('offers only the smallest size for a small photo', () => {
    const slide = photoSlide('/a', '/t', { width: 400, height: 300 }, '');
    expect(slide.srcset).toBe('/a?w=800 400w');
  });

  it('stops at the largest size for a huge photo', () => {
    const slide = photoSlide('/a', '/t', { width: 6000, height: 4000 }, '');
    expect(slide.src).toBe(`/a?w=${PHOTO_WIDTHS.at(-1)}`);
    expect(slide.srcset?.split(', ')).toHaveLength(PHOTO_WIDTHS.length);
  });
});

describe('logo colours', () => {
  it('gives all seven logo colours, each once, in some order', () => {
    const colors = shuffledLogoColors();
    expect(colors).toHaveLength(7);
    expect(new Set(colors).size).toBe(7);
    expect(colors.every((c) => /^var\(--logo-[a-z-]+\)$/.test(c))).toBe(true);
  });

  it('reads a CSS variable and the page font', () => {
    document.documentElement.style.setProperty('--logo-green', ' #72b45d ');
    expect(cssColor('--logo-green')).toBe('#72b45d');
    document.body.style.fontFamily = 'Mulish';
    expect(pageFont()).toBe('Mulish');
    document.documentElement.style.removeProperty('--logo-green');
    document.body.style.fontFamily = '';
  });

  it('asks the browser about reduced motion', () => {
    const ask = vi.spyOn(window, 'matchMedia');
    ask.mockReturnValue({ matches: false } as MediaQueryList);
    expect(prefersReducedMotion()).toBe(false);
    ask.mockReturnValue({ matches: true } as MediaQueryList);
    expect(prefersReducedMotion()).toBe(true);
    expect(ask).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    ask.mockRestore();
  });
});

describe('checkerTransparentPngs', () => {
  it('puts the checkerboard behind PNG slides only', () => {
    let onAppend: (e: unknown) => void = () => {};
    const lightbox = { on: (_: string, fn: (e: unknown) => void) => (onAppend = fn) };
    checkerTransparentPngs(lightbox as never);

    const slide = (type: string, alt: string) => {
      const element = document.createElement('img');
      onAppend({ content: { type, data: { alt }, element } });
      return element.classList.contains('pswp-checker');
    };
    expect(slide('image', 'logo.PNG')).toBe(true);
    expect(slide('image', 'foto.jpg')).toBe(false);
    expect(slide('html', 'logo.png')).toBe(false);
  });
});

describe('calendar event', () => {
  const event = {
    title: 'Mátra, tábor',
    start: new Date('2026-07-10T08:00:00Z'),
    days: 3,
    description: 'Indulás 10:00\nGyülekező a parkolóban',
    location: 'Mátraháza; turistaház',
    url: 'https://bodorgo.hu/turak/matra',
  };

  it('makes a Google Calendar link for whole days, the end day exclusive', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Mátra, tábor');
    expect(url.searchParams.get('dates')).toBe('20260710/20260713');
    expect(url.searchParams.get('ctz')).toBe('Europe/Budapest');
    expect(url.searchParams.get('location')).toBe('Mátraháza; turistaház');
    expect(url.searchParams.get('details')).toBe(`${event.description}\n\n${event.url}`);
  });

  it('counts the day in Budapest, not in UTC', () => {
    // 23:30 UTC on the 9th is already the 10th in Budapest
    const late = { ...event, start: new Date('2026-07-09T23:30:00Z'), days: 1 };
    expect(new URL(googleCalendarUrl(late)).searchParams.get('dates')).toBe('20260710/20260711');
  });

  it('leaves the place and the link out when there are none', () => {
    const bare = { title: 'Túra', start: event.start, days: 1, description: 'Leírás' };
    const url = new URL(googleCalendarUrl(bare));
    expect(url.searchParams.has('location')).toBe(false);
    expect(url.searchParams.get('details')).toBe('Leírás');
    const ics = icsContent(bare);
    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('URL:');
  });

  it('writes an all-day .ics event with escaped text', () => {
    const lines = icsContent(event).split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('DTSTART;VALUE=DATE:20260710');
    expect(lines).toContain('DTEND;VALUE=DATE:20260713');
    expect(lines).toContain('SUMMARY:Mátra\\, tábor');
    expect(lines).toContain('LOCATION:Mátraháza\\; turistaház');
    expect(lines).toContain('URL:https://bodorgo.hu/turak/matra');
    expect(lines.find((l) => l.startsWith('UID:'))).toBe(
      'UID:20260710-M%C3%A1tra%2C%20t%C3%A1bor@bodorgo.hu',
    );
    expect(lines.find((l) => l.startsWith('DTSTAMP:'))).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
    expect(icsContent(event).endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('folds long .ics lines at 74 characters', () => {
    const long = { ...event, description: 'a'.repeat(200) };
    const lines = icsContent(long).split('\r\n');
    expect(lines.every((l) => l.length <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
  });

  it('downloads the .ics through a temporary link', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:ics');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('matra.ics');
      expect(this.href).toBe('blob:ics');
    });

    downloadIcs(event, 'matra.ics');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ics');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
