import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../../components/avatar/avatar';
import { AuthService } from '../../../../auth/auth.service';
import { Podium, PodiumWinner } from '../../../../shared/podium/podium';
import {
  CourseResults,
  CourseSummary,
  FutokorService,
  racePace,
  raceTime,
} from '../../../../services/futokor';
import { CourseMap, MapRunner } from '../course-map/course-map';
import { RunList } from '../run-list/run-list';

// Someone in the table whose gender or age group isn't known.
const UNKNOWN = '–';

// The page asks the server again this often, so it shows what's happening
// as it happens: who has started, who has come in.
const REFRESH_MS = 5 * 1000;

// What the table is in the order of: everyone's best whole lap, or their
// best time on one stretch (its place among the stretches, from 0).
type SortBy = 'total' | number;

// Móka → Futókörök → Eredmények: every futókör there has been (one per
// tour, the newest first; they're never compared with one another) - and,
// with one opened (eredmenyek/<id>), its podium and a wide table of
// everyone: their best lap, and their best time on each stretch between two
// cards. The table can be narrowed by gender and age group (ten years
// wide) and put in the order of any of its times - who was the fastest on
// the 1st stretch? A tap on a runner shows all their runs, a tap on a run
// its splits. Whoever is running right now is listed above the table - and
// those of them who let it be seen are dots on the map, moving as they go.
@Component({
  selector: 'app-futokor-results',
  imports: [RouterLink, DatePipe, MatIconModule, Avatar, Podium, CourseMap, RunList],
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class FutokorResults implements OnDestroy {
  private futokor = inject(FutokorService);
  readonly myId = inject(AuthService).user()?.id;
  // The opened futókör - none: the list of them all.
  readonly courseId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  readonly time = raceTime;
  readonly pace = racePace;

  courses = signal<CourseSummary[] | null>(null);
  results = signal<CourseResults | null>(null);
  failed = signal(false);
  // The runner whose runs are open.
  openRunner = signal<string | null>(null);

  // --- Narrowing the table, and its order ---

  // '' = everyone.
  gender = signal('');
  ageGroup = signal('');
  sortBy = signal<SortBy>('total');
  readonly genders = [
    { value: '', label: 'Mindenki' },
    { value: 'nő', label: 'Nők' },
    { value: 'férfi', label: 'Férfiak' },
  ];
  // The age groups that anyone here is in, the youngest first.
  ageGroups = computed(() =>
    [
      ...new Set(
        (this.results()?.runners ?? []).map((r) => r.ageGroup).filter((g): g is string => !!g),
      ),
    ].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
  );

  // The stretches of the loop, from card to card: RAJT → 1. pont, ...,
  // the last point → CÉL.
  legs = computed(() => {
    const stops = (this.results()?.course.checkpoints ?? [])
      .filter((c) => c.kind === 'checkpoint')
      .sort((a, b) => a.order - b.order);
    const names = ['RAJT', ...stops.map((c) => c.label), 'CÉL'];
    return names.slice(1).map((to, i) => ({
      label: `${i + 1}. szakasz`,
      route: `${names[i]} → ${to}`,
    }));
  });

  // The runners shown, in the chosen order, each with their place in it
  // (none without a time to be placed by).
  rows = computed(() => {
    const legCount = this.legs().length;
    const sortBy = this.sortBy();
    const shown = (this.results()?.runners ?? [])
      .filter(
        (r) =>
          (!this.gender() || r.gender === this.gender()) &&
          (!this.ageGroup() || r.ageGroup === this.ageGroup()),
      )
      .map((r) => ({
        ...r,
        genderText: r.gender ?? UNKNOWN,
        ageText: r.ageGroup ?? UNKNOWN,
        // Their best time on each stretch, over all their runs (a run's
        // splits are in the order of the stretches).
        legMs: Array.from({ length: legCount }, (_, i) => {
          const times = r.runs.map((run) => run.splits[i]?.ms).filter((ms) => ms != null);
          return times.length ? Math.min(...times) : null;
        }),
      }));

    const value = (r: (typeof shown)[number]) =>
      sortBy === 'total' ? (r.best?.totalMs ?? null) : r.legMs[sortBy];
    // The server's order (by the best lap) stays among equals.
    const sorted = shown
      .map((r, i) => ({ r, i, v: value(r) }))
      .sort((a, b) =>
        a.v === null || b.v === null
          ? Number(a.v === null) - Number(b.v === null) || a.i - b.i
          : a.v - b.v || a.i - b.i,
      );
    let place = 0;
    return sorted.map(({ r, v }) => ({ ...r, place: v === null ? null : (place += 1) }));
  });

  // The best time of each column among the runners shown.
  records = computed(() => {
    const rows = this.rows();
    const best = (values: (number | null | undefined)[]) => {
      const times = values.filter((v): v is number => v != null);
      return times.length ? Math.min(...times) : null;
    };
    return {
      total: best(rows.map((r) => r.best?.totalMs)),
      legs: this.legs().map((_, i) => best(rows.map((r) => r.legMs[i]))),
    };
  });

  // The podium is of the best laps of the runners shown: the women's, the
  // 30-39s'...
  winners = computed<PodiumWinner[]>(() =>
    this.rows()
      .filter((r) => r.best)
      .sort((a, b) => a.best!.totalMs! - b.best!.totalMs!)
      .slice(0, 3)
      .map((r, i) => ({
        place: (i + 1) as 1 | 2 | 3,
        userId: r.userId,
        name: r.name,
        photoVersion: r.photoUpdatedAt,
      })),
  );
  podiumTitle = computed(() => {
    const who = this.genders.find((g) => g.value && g.value === this.gender())?.label;
    const age = this.ageGroup() ? `${this.ageGroup()} évesek` : '';
    return ['A leggyorsabbak', [who, age].filter(Boolean).join(', ')].filter(Boolean).join(' – ');
  });
  hasMap = computed(() => (this.results()?.course.track?.length ?? 0) > 1);

  // --- Live ---

  // Ticks every second, for the clocks of the runs that are on.
  private now = signal(Date.now());
  private ticker = setInterval(() => this.now.set(Date.now()), 1000);
  private refresher = setInterval(() => {
    if (document.visibilityState === 'visible') this.load();
  }, REFRESH_MS);

  // Where they are, of those who let it be seen.
  onMap = computed<MapRunner[]>(() =>
    (this.results()?.positions ?? []).map((p) => ({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      me: p.userId === this.myId,
    })),
  );

  // Who is on the course right now: started, not yet in.
  live = computed(() => {
    const stops = (this.results()?.course.checkpoints.length ?? 1) - 1;
    const seen = new Set((this.results()?.positions ?? []).map((p) => p.userId));
    return (this.results()?.runners ?? [])
      .flatMap((r) =>
        r.runs
          .filter((run) => run.status === 'running')
          .map((run) => ({
            userId: r.userId,
            name: r.name,
            photoUpdatedAt: r.photoUpdatedAt,
            onMap: seen.has(r.userId),
            startedAt: Date.parse(run.startedAt),
            where:
              run.passed >= stops
                ? 'a cél felé'
                : run.passed
                  ? `${run.passed}. pont megvan`
                  : 'elrajtolt',
          })),
      )
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((r) => ({ ...r, elapsed: raceTime(Math.max(0, this.now() - r.startedAt)) }));
  });

  constructor() {
    this.load();
  }

  // (Again and again: a failed try while the page is already showing
  // something is nothing to tell - the next one comes.)
  private load() {
    const fail = () => {
      if (!this.results() && !this.courses()) this.failed.set(true);
    };
    if (this.courseId) {
      this.futokor
        .getCourseResults(this.courseId)
        .subscribe({ next: (results) => this.results.set(results), error: fail });
    } else {
      this.futokor
        .getResults()
        .subscribe({ next: (courses) => this.courses.set(courses), error: fail });
    }
  }

  ngOnDestroy() {
    clearInterval(this.ticker);
    clearInterval(this.refresher);
  }

  toggle(userId: string) {
    this.openRunner.set(this.openRunner() === userId ? null : userId);
  }
}
