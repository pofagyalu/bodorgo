import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { SunDay, Tour } from '../../../services/tour';
import { timeZoneOf } from '../../../shared/countries';

// What the sky is doing: the colour and the words of each stretch of the
// day. 'dawn' and 'dusk' are the darker twilight next to the night - drawn
// on the line, but no moment of their own.
type Phase = 'night' | 'dawn' | 'blue' | 'golden' | 'day' | 'dusk';

const PHASE_NAMES: Record<Phase, string> = {
  night: 'Éjszaka',
  dawn: 'Hajnal',
  blue: 'Kékóra',
  golden: 'Aranyóra',
  day: 'Nappal',
  dusk: 'Alkonyat',
};

const PHASE_LINES: Record<Phase, string> = {
  night: 'Tábortűz és csillagok',
  dawn: 'A madarak már próbálnak',
  blue: 'A fotósok most nem esznek',
  golden: 'Mindenki szebb, mint valójában',
  day: 'Indulhat a túra – naptejet elő!',
  dusk: 'Még látszik az út a szálláshoz',
};

// The nine moments on the line, in the day's order. `phase` is what starts
// there (its colour on the dot); rise/set are the small ones.
interface MomentDef {
  key: keyof Omit<SunDay, 'day'>;
  name: string;
  line: string;
  phase: Phase;
  size: 'small' | 'normal' | 'large';
}

const MOMENTS: MomentDef[] = [
  {
    key: 'nightEnd',
    name: 'Éjszaka vége',
    line: 'A csillagok hazamennek',
    phase: 'dawn',
    size: 'normal',
  },
  {
    key: 'blueHourStart',
    name: 'Kékóra',
    line: 'A korán kelők titkos műsora',
    phase: 'blue',
    size: 'normal',
  },
  {
    key: 'goldenHourStart',
    name: 'Aranyóra',
    line: 'Mindenki szebb, mint valójában',
    phase: 'golden',
    size: 'normal',
  },
  {
    key: 'sunrise',
    name: 'Napkelte',
    line: 'Megjött a főszereplő',
    phase: 'golden',
    size: 'small',
  },
  {
    key: 'dayStart',
    name: 'Nappal',
    line: 'Indulhat a túra – naptejet elő!',
    phase: 'day',
    size: 'large',
  },
  {
    key: 'goldenHour',
    name: 'Aranyóra',
    line: 'Most mindenki jól jön ki a képen',
    phase: 'golden',
    size: 'normal',
  },
  {
    key: 'sunset',
    name: 'Napnyugta',
    line: 'Egy perc csend… aztán koccintás',
    phase: 'golden',
    size: 'small',
  },
  {
    key: 'blueHour',
    name: 'Kékóra',
    line: 'A fotósok most nem esznek',
    phase: 'blue',
    size: 'normal',
  },
  { key: 'night', name: 'Éjszaka', line: 'Tábortűz és csillagok', phase: 'night', size: 'normal' },
];

// Where the stretch after each moment really changes colour: after the
// evening blue hour comes the darker dusk (blueHourEnd), before the night.
const DUSK_KEY = 'blueHourEnd';

// The stretch from Nappal to the evening Aranyóra is drawn three times as
// long on a wide screen - it is most of the day.
const WIDE_KEY = 'dayStart';

const MINUTE = 60 * 1000;

export interface Moment extends MomentDef {
  id: string; // the day too: a new day's line draws itself again
  time: string; // "04:51", in the place's own zone
  at: number;
  nextPhase: Phase | null; // the colour the line runs into
  wide: boolean;
}

// "Az idő járása" on the tour page (under the Életviteli tanácsok): the
// sun's day on each tour day, from the end of the night to the night - the
// moments come ready from the server (tour.sunDays, saved when the tour's
// dates or place change). A day can be stepped through with the arrows (a
// swipe on a phone); on a day of the tour that is today the line shows
// where the sun is now, minute by minute. A tap on a moment puts it in the
// big sun at the top. Nothing at all without the times (no place).
@Component({
  selector: 'app-tour-sun-day',
  templateUrl: './tour-sun-day.html',
  styleUrl: './tour-sun-day.scss',
})
export class TourSunDay {
  tour = input.required<Tour>();

  private readonly now = signal(Date.now());

  days = computed(() => this.tour().sunDays ?? []);
  timeZone = computed(() => timeZoneOf(this.tour().location?.country));

  // null: the default day - today's, if the tour is on, else the first.
  private readonly picked = signal<number | null>(null);
  // The moment tapped on the line (its key) - null: now, or Nappal.
  readonly selected = signal<string | null>(null);

  index = computed(() => {
    const picked = this.picked();
    if (picked != null) return picked;
    const today = this.dateKey(this.now());
    const i = this.days().findIndex((d) => this.dateKey(Date.parse(d.dayStart)) === today);
    return Math.max(i, 0);
  });

  day = computed<SunDay | null>(() => this.days()[this.index()] ?? null);

  // Live: the shown day is today where the tour is.
  live = computed(() => {
    const day = this.day();
    return !!day && this.dateKey(Date.parse(day.dayStart)) === this.dateKey(this.now());
  });

  moments = computed<Moment[]>(() => {
    const day = this.day();
    if (!day) return [];
    return MOMENTS.map((m, i) => ({
      ...m,
      id: `${day.day}-${m.key}`,
      at: Date.parse(day[m.key]),
      time: this.clock(Date.parse(day[m.key])),
      nextPhase:
        m.key === 'blueHour' ? 'dusk' : i + 1 < MOMENTS.length ? MOMENTS[i + 1].phase : null,
      wide: m.key === WIDE_KEY,
    }));
  });

  // The date line of the header: "2. nap · július 12., szombat".
  dateLabel = computed(() => {
    const day = this.day();
    if (!day) return '';
    const date = new Intl.DateTimeFormat('hu-HU', {
      timeZone: this.timeZone(),
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(Date.parse(day.dayStart));
    return `${day.day}. nap · ${date}`;
  });

  // "15 ó 47 p napfény", and how it differs from the day before.
  daylight = computed(() => {
    const minutes = this.daylightMinutes(this.day());
    if (minutes == null) return '';
    return `${Math.floor(minutes / 60)} ó ${minutes % 60} p napfény`;
  });

  daylightChange = computed(() => {
    const before = this.daylightMinutes(this.days()[this.index() - 1] ?? null);
    const minutes = this.daylightMinutes(this.day());
    if (before == null || minutes == null) return '';
    const diff = minutes - before;
    if (diff === 0) return 'ugyanannyi, mint előző nap';
    return `${Math.abs(diff)} perccel ${diff > 0 ? 'több' : 'kevesebb'}, mint előző nap`;
  });

  // Where the sun is now on the line: in the stretch after moment `index`,
  // `fraction` of the way to the next one. null when it isn't today, or
  // it is night (before the night's end or after it starts again).
  nowSpot = computed<{ index: number; fraction: number } | null>(() => {
    if (!this.live()) return null;
    const now = this.now();
    const ms = this.moments();
    for (let i = 0; i + 1 < ms.length; i++) {
      if (now >= ms[i].at && now < ms[i + 1].at) {
        return { index: i, fraction: (now - ms[i].at) / (ms[i + 1].at - ms[i].at) };
      }
    }
    return null;
  });

  // Per stretch of the line, on a live day: already behind us, the one the
  // sun is in, or still ahead ('' on any other day).
  progress = computed<('past' | 'now' | 'ahead' | '')[]>(() => {
    const ms = this.moments();
    if (!this.live()) return ms.map(() => '');
    const spot = this.nowSpot();
    const now = this.now();
    return ms.map((m, i) => {
      if (spot) return i < spot.index ? 'past' : i === spot.index ? 'now' : 'ahead';
      return now >= ms[ms.length - 1].at ? 'past' : 'ahead';
    });
  });

  // What the big sun at the top shows: the moment tapped, or right now,
  // or (a day that isn't today) the daylight.
  focus = computed(() => {
    const key = this.selected();
    const moment = this.moments().find((m) => m.key === key);
    if (moment) {
      return {
        phase: moment.phase,
        name: moment.name,
        line: moment.line,
        time: moment.time,
        now: false,
      };
    }
    if (this.live()) {
      const phase = this.phaseAt(this.now());
      return {
        phase,
        name: PHASE_NAMES[phase],
        line: PHASE_LINES[phase],
        time: this.clock(this.now()),
        now: true,
      };
    }
    const day = this.moments().find((m) => m.key === WIDE_KEY)!;
    return day && { phase: day.phase, name: day.name, line: day.line, time: day.time, now: false };
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), MINUTE);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  step(by: number) {
    const next = this.index() + by;
    if (next < 0 || next >= this.days().length) return;
    this.picked.set(next);
    this.selected.set(null);
  }

  select(key: string) {
    this.selected.set(this.selected() === key ? null : key);
  }

  // A sideways swipe on the panel changes the day (phone).
  private touchStart: { x: number; y: number } | null = null;

  onTouchStart(event: TouchEvent) {
    const t = event.touches[0];
    this.touchStart = { x: t.clientX, y: t.clientY };
  }

  onTouchEnd(event: TouchEvent) {
    const start = this.touchStart;
    this.touchStart = null;
    const t = event.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) this.step(dx < 0 ? 1 : -1);
  }

  // Which stretch of the day an instant falls into.
  private phaseAt(at: number): Phase {
    const day = this.day()!;
    const t = (key: keyof Omit<SunDay, 'day'>) => Date.parse(day[key]);
    if (at < t('nightEnd') || at >= t('night')) return 'night';
    if (at < t('blueHourStart')) return 'dawn';
    if (at < t('goldenHourStart')) return 'blue';
    if (at < t('dayStart')) return 'golden';
    if (at < t('goldenHour')) return 'day';
    if (at < t('blueHour')) return 'golden';
    if (at < t(DUSK_KEY)) return 'blue';
    return 'dusk';
  }

  private daylightMinutes(day: SunDay | null): number | null {
    if (!day) return null;
    return Math.round((Date.parse(day.sunset) - Date.parse(day.sunrise)) / MINUTE);
  }

  private clock(at: number): string {
    return new Intl.DateTimeFormat('hu-HU', {
      timeZone: this.timeZone(),
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  }

  // The calendar day of an instant, where the tour is ("2027-07-10").
  private dateKey(at: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone() }).format(at);
  }
}
