import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PeriodOption, PeriodPicker } from '../../../components/period-picker/period-picker';
import { ActivityChart } from '../../../components/activity-chart/activity-chart';
import { DeviceChart } from '../../../components/device-chart/device-chart';
import { StatsDays, ViewStats, ViewTrackerService } from '../../../services/view-tracker';

// One row of a top list, whatever its kind.
interface TopRow {
  key: string;
  title: string;
  sub: string | null;
  link: string | null;
  views: number;
  viewers: number;
}

interface TopList {
  key: string;
  title: string;
  // "megtekintés" / "lejátszás" / "megnyitás"
  unit: string;
  rows: TopRow[];
}

// Klub → Statisztika (admins): how the app is used - who came on which
// day, on what, the most viewed photos, videos, tours and songs, and what
// the songbook was searched for in vain (server utils/views.js). Totals
// only: nobody is shown who looked at what.
@Component({
  selector: 'app-statistics',
  imports: [RouterLink, PeriodPicker, ActivityChart, DeviceChart],
  templateUrl: './statistics.html',
  styleUrl: './statistics.scss',
})
export class Statistics {
  private views = inject(ViewTrackerService);

  readonly periodOptions: PeriodOption[] = [
    { value: '0', label: 'Összes' },
    { value: '7', label: '7 nap' },
    { value: '30', label: '30 nap' },
    { value: '90', label: '90 nap' },
  ];
  period = signal('30');

  stats = signal<ViewStats | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const days = Number(this.period()) as StatsDays;
      this.loading.set(true);
      this.error.set(null);
      this.views.stats(days).subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('A statisztikát most nem sikerült betölteni.');
          this.loading.set(false);
        },
      });
    });
  }

  periodText = computed(() =>
    this.period() === '0' ? 'mióta mérjük' : `az elmúlt ${this.period()} napban`,
  );

  // Of the people in the period: here on at least two days.
  returningPercent = computed(() => {
    const p = this.stats()?.people;
    return p?.period ? Math.round((p.returning / p.period) * 100) : 0;
  });

  // Of the person-days: with the installed app.
  appPercent = computed(() => {
    const s = this.stats();
    return s?.people.personDays ? Math.round((s.app.days / s.people.personDays) * 100) : 0;
  });

  hasDevices = computed(() => {
    const d = this.stats()?.devices;
    return !!d && d.phone + d.tablet + d.desktop > 0;
  });

  // The top lists, each kind the same shape.
  lists = computed<TopList[]>(() => {
    const top = this.stats()?.top;
    if (!top) return [];
    return [
      {
        key: 'photo',
        title: 'Fotók',
        unit: 'megtekintés',
        rows: top.photo.map((p) => ({
          key: p.key,
          title: p.title,
          sub: p.filename,
          link: p.link,
          views: p.views,
          viewers: p.viewers,
        })),
      },
      {
        key: 'video',
        title: 'Videók',
        unit: 'megtekintés',
        rows: top.video.map((v) => ({
          key: v.key,
          title: v.title,
          sub: v.subtitle,
          link: v.link,
          views: v.views,
          viewers: v.viewers,
        })),
      },
      {
        key: 'tour',
        title: 'Táborok',
        unit: 'megnyitás',
        rows: top.tour.map((t) => ({
          key: t.key,
          title: `${t.order}. ${t.title}`,
          sub: null,
          link: t.link,
          views: t.views,
          viewers: t.viewers,
        })),
      },
      {
        key: 'track',
        title: 'Zenék',
        unit: 'lejátszás',
        rows: top.track.map((t) => ({
          key: t.key,
          title: t.title,
          sub: t.artist,
          link: null,
          views: t.views,
          viewers: t.viewers,
        })),
      },
      {
        key: 'song',
        title: 'Daloskönyv',
        unit: 'megnyitás',
        rows: top.song.map((s) => ({
          key: s.key,
          title: s.title,
          sub: s.artist || null,
          link: s.link,
          views: s.views,
          viewers: s.viewers,
        })),
      },
    ];
  });

  // "1 234"
  count(n: number): string {
    return n.toLocaleString('hu-HU');
  }
}
