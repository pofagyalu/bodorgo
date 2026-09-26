import { Component, OnDestroy, computed, input, output, signal } from '@angular/core';
import { Tour } from '../../services/tour';

// When a tour actually starts: its start day at the time of day 1's first
// program entry (e.g. "14:00 – Érkezés"), or that day's midnight when day
// 1 has no program yet. The start date is read in local time, like the
// rest of the app does.
export function tourStartTime(t: Tour): Date {
  const d = new Date(t.startDate);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const times = (t.schedule ?? [])
    .filter((e) => e.day === 1)
    .map((e) => /^(\d{1,2}):(\d{2})/.exec(e.time?.trim() ?? ''))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]) * 60 + Number(m[2]))
    .filter((minutes) => minutes < 24 * 60);
  if (times.length) start.setMinutes(Math.min(...times));
  return start;
}

// A tour is over at midnight after its last day.
export function tourEndTime(t: Tour): Date {
  const d = new Date(t.startDate);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + t.duration);
}

// Which of a seven-segment digit's segments (a-g) light up for each
// character - digits, the dash, and the few letters that can be drawn.
// É and Ő also get their accents, as small extra segments above.
const GLYPHS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  É: 'adefg1',
  L: 'def',
  Ő: 'abcdef23',
};

// Each segment's shape in a 24x44 digit - pointed ends, like a real LED.
// 1 is an acute accent, 2 and 3 a double acute, drawn above the digit.
const SEGMENT_SHAPES: Record<string, string> = {
  a: '6,2 18,2 20,4 18,6 6,6 4,4',
  b: '20,5 22,7 22,19 20,21 18,19 18,7',
  c: '20,23 22,25 22,37 20,39 18,37 18,25',
  d: '6,38 18,38 20,40 18,42 6,42 4,40',
  e: '4,23 6,25 6,37 4,39 2,37 2,25',
  f: '4,5 6,7 6,19 4,21 2,19 2,7',
  g: '6,20 18,20 20,22 18,24 6,24 4,22',
  '1': '10,-2 15,-8 18,-7 13,-1',
  '2': '6,-2 10,-8 13,-7 9,-1',
  '3': '13,-2 17,-8 20,-7 16,-1',
};
const DIGIT_SEGMENTS = 'abcdefg'.split('');

interface Glyph {
  lit: string[];
  dark: string[];
}

interface Group {
  label: string;
  glyphs: Glyph[];
}

function glyph(ch: string): Glyph {
  const lit = (GLYPHS[ch] ?? '').split('');
  return { lit, dark: DIGIT_SEGMENTS.filter((s) => !lit.includes(s)) };
}

const group = (label: string, text: string): Group => ({ label, glyphs: text.split('').map(glyph) });

type Mode = 'countdown' | 'live' | 'idle';

// A glowing seven-segment LED clock for the tours: counts down to the
// next one, shows ÉLŐ while one is on, then moves on to the next - or,
// with nothing planned, blinks dashes like a clock that lost its time.
// Picks the tour itself (every second, from the list it's given);
// clicking it emits that tour's id (the chat opens it).
@Component({
  selector: 'app-tour-countdown',
  templateUrl: './tour-countdown.html',
  styleUrl: './tour-countdown.scss',
})
export class TourCountdown implements OnDestroy {
  tours = input.required<Tour[]>();
  pick = output<string>();

  readonly shapes = SEGMENT_SHAPES;

  private now = signal(Date.now());
  private timer = setInterval(() => this.now.set(Date.now()), 1000);

  // The one going on right now, else the soonest one still to come.
  tour = computed<Tour | null>(() => {
    const now = this.now();
    const tours = this.tours();
    const live = tours.find((t) => tourStartTime(t).getTime() <= now && now < tourEndTime(t).getTime());
    if (live) return live;
    return (
      tours
        .filter((t) => tourStartTime(t).getTime() > now)
        .sort((a, b) => tourStartTime(a).getTime() - tourStartTime(b).getTime())[0] ?? null
    );
  });

  mode = computed<Mode>(() => {
    const t = this.tour();
    if (!t) return 'idle';
    return tourStartTime(t).getTime() <= this.now() ? 'live' : 'countdown';
  });

  // Once a second: the colons blink, and ÉLŐ pulses.
  tick = computed(() => Math.floor(this.now() / 1000) % 2 === 0);

  private remaining = computed(() => {
    const t = this.tour();
    return t ? Math.max(0, tourStartTime(t).getTime() - this.now()) : 0;
  });

  groups = computed<Group[]>(() => {
    switch (this.mode()) {
      case 'live':
        return [group('', '--'), group('', 'ÉLŐ'), group('', '--')];
      case 'idle':
        return [group('nap', '--'), group('óra', '--'), group('perc', '--'), group('mp', '--')];
      default: {
        const total = Math.floor(this.remaining() / 1000);
        const days = Math.floor(total / 86400);
        const pad = (n: number, width = 2) => String(n).padStart(width, '0');
        return [
          group('nap', pad(days, Math.max(2, String(days).length))),
          group('óra', pad(Math.floor(total / 3600) % 24)),
          group('perc', pad(Math.floor(total / 60) % 60)),
          group('mp', pad(total % 60)),
        ];
      }
    }
  });

  headLabel = computed(() => ({ countdown: 'Indulásig', live: 'Most zajlik', idle: 'Következő tábor' })[this.mode()]);
  headTitle = computed(() => {
    const t = this.tour();
    return t ? `${t.order}. ${t.title}` : 'még nincs kiírva';
  });

  // For screen readers - minutes are precise enough.
  ariaLabel = computed(() => {
    const t = this.tour();
    if (!t) return 'A következő tábor még nincs kiírva';
    if (this.mode() === 'live') return `${t.title}: most zajlik`;
    const total = Math.floor(this.remaining() / 1000);
    return `${t.title}: indulásig ${Math.floor(total / 86400)} nap ${Math.floor(total / 3600) % 24} óra ${
      Math.floor(total / 60) % 60
    } perc`;
  });

  select() {
    const t = this.tour();
    if (t) this.pick.emit(t._id);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }
}
