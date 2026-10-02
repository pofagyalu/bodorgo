import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom, map } from 'rxjs';
import { environment } from '../../environments/environment';
// The rules of a run: the very file the server uses (plain JavaScript, with
// its types beside it) - the phone has to decide the same things on its
// own, where there's no signal.
import {
  RuleCourse,
  RuleRun,
  RunStatus,
  RuleSplit,
  ScanOutcome,
  applyScan,
  isExpired,
  nextCheckpoint,
} from '../../../../server/src/futokor/runRules.js';

// A card, as the admin sees it.
export interface FutokorTag {
  tagId: string;
  kind: 'startFinish' | 'checkpoint';
  retired: boolean;
  url: string; // what its QR code says
  createdAt: string;
}

// A course: a tour's loop - everything the phone needs to run it offline.
export interface FutokorCourse extends RuleCourse {
  _id: string;
  tour: { _id: string; title?: string };
  name: string;
  opensAt: string;
  closesAt: string;
  // The loop to draw on the map: [lat, lng] pairs - empty if it has none.
  track?: [number, number][];
  elevationGainM?: number | null;
}

// A run as the server worked it out from the scans it has.
export interface FutokorRun {
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  passed: number;
  splits: RuleSplit[];
  totalMs: number | null;
  paceSecPerKm: number | null;
  flagged: boolean;
}

export interface FutokorRunner {
  userId: string;
  name: string;
  photoUpdatedAt: string | null;
  totalMs: number;
  paceSecPerKm: number | null;
  finishedAt: string;
  flagged: boolean;
  finishedRuns: number;
}

// What changing a course takes (see the server's updateCourse).
export interface CourseChanges {
  name?: string;
  opensAt?: string;
  closesAt?: string;
  maxRunDurationMin?: number | null;
  distanceM?: number | null;
  startTagId?: string;
  stops?: { tagId: string; distanceAlongM: number | null }[];
}

// A scan waiting to be sent: made on the phone, uploaded when it can be.
interface QueuedScan {
  clientScanId: string;
  token?: string;
  deviceTime: string;
  action?: 'restart' | 'giveUp';
  // Whose it is, if they run with their futókód (not as whoever is logged
  // in on this phone).
  runnerCode?: string;
}

// Who runs on this phone: whoever is logged in on it - or someone who gave
// their futókód (`code`), on a phone nobody is logged in on, or a lent one.
export interface Runner {
  name: string;
  code?: string;
}

// What a card (or giving up) came to, for the big green / red answer. Two
// more results than the rules have: there's no course to run on this
// phone, or the course isn't open now.
export interface ScanAnswer extends Omit<ScanOutcome, 'result'> {
  result: ScanOutcome['result'] | 'noCourse' | 'closed';
  run: RuleRun | null;
}

// Kept on the phone, so a run survives a closed tab, a reload, no signal.
const COURSE_KEY = 'futokor-course';
const RUN_KEY = 'futokor-run';
const QUEUE_KEY = 'futokor-queue';
const ME_KEY = 'futokor-me';
const CODE_RUNNER_KEY = 'futokor-runner';
// As many as the server takes in one request.
const BATCH = 40;

const load = <T>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
};
// (Nothing to keep: the key goes - futokor.guard.ts looks for the course.)
const save = (key: string, value: unknown) =>
  value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value));

// "4:32" - or "1:04:32" from an hour up.
export function raceTime(ms: number | null | undefined): string {
  if (ms == null) return '–';
  const total = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// "5:33 /km"
export function racePace(secPerKm: number | null | undefined): string {
  if (!secPerKm) return '–';
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')} /km`;
}

// Futókör: the running race. A runner's phone scans the cards; what each
// scan means is decided right here, with the server's own rules, so it
// works where there's no signal - the scans wait in a queue and go up when
// there's a connection, and the server's answer (worked out from all of the
// runner's scans) is the official one.
@Injectable({ providedIn: 'root' })
export class FutokorService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/futokor`;

  // The course on this phone (the one open now, or the next to open).
  course = signal<FutokorCourse | null>(load<FutokorCourse>(COURSE_KEY));
  // My latest run here, as this phone's own scans make it.
  run = signal<RuleRun | null>(load<RuleRun>(RUN_KEY));
  private queue = signal<QueuedScan[]>(load<QueuedScan[]>(QUEUE_KEY) ?? []);
  // My runs as the server has them - once it has answered.
  serverRuns = signal<FutokorRun[]>([]);
  syncing = signal(false);

  // Whoever is logged in on this phone - remembered, so the phone knows it
  // in the garden too, where it can't ask.
  private me = signal<Runner | null>(load<Runner>(ME_KEY));
  // Someone running with their futókód instead.
  private codeRunner = signal<Runner | null>(load<Runner>(CODE_RUNNER_KEY));
  runner = computed(() => this.codeRunner() ?? this.me());
  // The phone's own (logged-in) runner, while someone else runs by code.
  owner = this.me.asReadonly();
  // Something the runner has to know: a futókód the server didn't know.
  problem = signal('');

  waiting = computed(() => this.queue().length);
  // The card to find next - null when it's the FINISH (or nothing is on).
  next = computed(() => {
    const course = this.course();
    return course ? nextCheckpoint(course, this.run()) : null;
  });

  constructor() {
    // Whatever waited for a connection goes up as soon as there is one.
    window.addEventListener('online', () => void this.sync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.sync();
    });
  }

  // --- The runner ---

  // The course to run and my runs on it, fresh from the server - and the
  // queue sent on the way. Without a connection what's on the phone stays.
  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{
          data: { course: FutokorCourse | null; runs: FutokorRun[]; runner: { name: string } };
        }>(`${this.apiUrl}/active`),
      );
      this.setCourse(res.data.course);
      this.me.set({ name: res.data.runner.name });
      save(ME_KEY, this.me());
      if (!this.codeRunner()) this.serverRuns.set(res.data.runs);
    } catch (err) {
      // Nobody is logged in here (or not someone who is in yet): the course
      // is everyone's to get - they run with a futókód. Without a
      // connection what's on the phone stays as it is.
      if (err instanceof HttpErrorResponse && [401, 403].includes(err.status)) {
        this.me.set(null);
        save(ME_KEY, null);
        await this.loadPublicCourse();
      }
    }
    await this.sync();
  }

  private async loadPublicCourse() {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { course: FutokorCourse | null } }>(`${this.apiUrl}/course`),
      );
      this.setCourse(res.data.course);
    } catch {
      // Offline.
    }
  }

  private setCourse(course: FutokorCourse | null) {
    // A different course: the old one's run isn't this one's.
    if (course?._id !== this.course()?._id) this.setRun(null);
    this.course.set(course);
    save(COURSE_KEY, course);
  }

  // Someone gives their futókód to run with. Answers their name - 'unknown'
  // if there's no such code, null if there's no connection to ask (the code
  // is then taken as it is, and checked when the scans go up).
  async runWithCode(code: string): Promise<string | 'unknown' | null> {
    let name: string | null = null;
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: { name: string } }>(`${this.apiUrl}/runner`, { code }),
      );
      name = res.data.name;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status !== 0) return 'unknown';
    }
    // Another runner: the run on this phone isn't theirs.
    if (this.codeRunner()?.code !== code) {
      this.setRun(null);
      this.serverRuns.set([]);
    }
    this.codeRunner.set({ code, name: name ?? `${code}-es futókód` });
    save(CODE_RUNNER_KEY, this.codeRunner());
    return name;
  }

  // Back to whoever is logged in on this phone.
  runAsMyself() {
    if (!this.codeRunner()) return;
    this.codeRunner.set(null);
    save(CODE_RUNNER_KEY, null);
    this.setRun(null);
    this.serverRuns.set([]);
    void this.refresh();
  }

  // A card's link was opened, or its QR code read: the end of that link.
  scan(token: string, action?: 'restart'): ScanAnswer {
    const dot = token.lastIndexOf('.');
    return this.apply({ token, tagId: dot > 0 ? token.slice(0, dot) : token, action });
  }

  giveUp(): ScanAnswer {
    return this.apply({ tagId: null, action: 'giveUp' });
  }

  private apply(input: {
    token?: string;
    tagId: string | null;
    action?: 'restart' | 'giveUp';
  }): ScanAnswer {
    const course = this.course();
    const now = Date.now();
    if (!course) return { result: 'noCourse', run: null };
    if (now < Date.parse(course.opensAt) || now > Date.parse(course.closesAt)) {
      return { result: 'closed', run: this.run() };
    }

    const clientScanId = crypto.randomUUID();
    const { run, outcome } = applyScan(course, this.run(), {
      clientScanId,
      tagId: input.tagId,
      time: now,
      action: input.action ?? null,
    });
    // Only what counted goes to the server - it would refuse the rest the
    // same way.
    if (['started', 'passed', 'finished', 'gaveUp'].includes(outcome.result)) {
      this.setRun(run);
      this.setQueue([
        ...this.queue(),
        {
          clientScanId,
          token: input.token,
          deviceTime: new Date(now).toISOString(),
          action: input.action,
          runnerCode: this.codeRunner()?.code,
        },
      ]);
      void this.sync();
    }
    return { ...outcome, run: this.run() };
  }

  // A run left open for longer than the course allows is over.
  expireIfDue() {
    const course = this.course();
    const run = this.run();
    if (course && run && isExpired(course, run, Date.now())) {
      this.setRun({ ...run, status: 'expired' });
    }
  }

  // Sends what waits, a batch at a time; what the server has answered
  // leaves the queue. Fails quietly without a connection - the next try
  // comes with the next scan, or when the phone is online again.
  async sync(): Promise<void> {
    if (this.syncing() || !this.queue().length) return;
    this.syncing.set(true);
    try {
      while (this.queue().length) {
        // One runner's scans at a time (the phone may have been lent).
        const runnerCode = this.queue()[0].runnerCode;
        const batch = this.queue()
          .filter((s) => s.runnerCode === runnerCode)
          .slice(0, BATCH);
        let res;
        try {
          res = await firstValueFrom(
            this.http.post<{
              data: {
                results: { clientScanId: string }[];
                runs: { courseId: string; runs: FutokorRun[] }[];
              };
            }>(`${this.apiUrl}/scans`, { runnerCode, scans: batch }),
          );
        } catch (err) {
          // A futókód nobody has: those scans can never count - they go,
          // and the runner is told.
          if (runnerCode && err instanceof HttpErrorResponse && err.status === 404) {
            this.setQueue(this.queue().filter((s) => s.runnerCode !== runnerCode));
            this.problem.set(
              `Nincs ${runnerCode} futókód – az ezzel futott kör sajnos nem számít. Kérdezd meg a kódodat egy admintól.`,
            );
            if (this.codeRunner()?.code === runnerCode) {
              this.codeRunner.set(null);
              save(CODE_RUNNER_KEY, null);
              this.setRun(null);
            }
            continue;
          }
          throw err;
        }
        const answered = new Set(res.data.results.map((r) => r.clientScanId));
        this.setQueue(this.queue().filter((s) => !answered.has(s.clientScanId)));
        const mine = res.data.runs.find((r) => r.courseId === this.course()?._id);
        // The list on the screen is the current runner's.
        if (mine && runnerCode === this.codeRunner()?.code) this.serverRuns.set(mine.runs);
        if (!answered.size) break;
      }
    } catch {
      // Still offline, or the session has run out: they stay in the queue.
    } finally {
      this.syncing.set(false);
    }
  }

  private setRun(run: RuleRun | null) {
    this.run.set(run);
    save(RUN_KEY, run);
  }

  private setQueue(queue: QueuedScan[]) {
    this.queue.set(queue);
    save(QUEUE_KEY, queue);
  }

  getLeaderboard(courseId: string): Observable<FutokorRunner[]> {
    return this.http
      .get<{ data: { runners: FutokorRunner[] } }>(`${this.apiUrl}/courses/${courseId}/leaderboard`)
      .pipe(map((res) => res.data.runners));
  }

  // --- The admin: cards and courses ---

  getTags(): Observable<FutokorTag[]> {
    return this.http
      .get<{ data: { tags: FutokorTag[] } }>(`${this.apiUrl}/tags`)
      .pipe(map((res) => res.data.tags));
  }

  // `count` checkpoint cards - or one START/FINISH card.
  createTags(body: { count: number } | { kind: 'startFinish' }): Observable<FutokorTag[]> {
    return this.http
      .post<{ data: { tags: FutokorTag[] } }>(`${this.apiUrl}/tags`, body)
      .pipe(map((res) => res.data.tags));
  }

  retireTag(tagId: string, retired: boolean): Observable<FutokorTag> {
    return this.http
      .patch<{ data: { tag: FutokorTag } }>(`${this.apiUrl}/tags/${tagId}`, { retired })
      .pipe(map((res) => res.data.tag));
  }

  // A plain link: the browser opens the PDF itself (the session cookie
  // rides along).
  readonly tagSheetUrl = `${this.apiUrl}/tags/sheet`;

  getCourses(): Observable<FutokorCourse[]> {
    return this.http
      .get<{ data: { courses: FutokorCourse[] } }>(`${this.apiUrl}/courses`)
      .pipe(map((res) => res.data.courses));
  }

  createCourse(body: { tourId: string; opensAt: string; closesAt: string }) {
    return this.http
      .post<{ data: { course: FutokorCourse } }>(`${this.apiUrl}/courses`, body)
      .pipe(map((res) => res.data.course));
  }

  updateCourse(id: string, changes: CourseChanges): Observable<FutokorCourse> {
    return this.http
      .patch<{ data: { course: FutokorCourse } }>(`${this.apiUrl}/courses/${id}`, changes)
      .pipe(map((res) => res.data.course));
  }

  deleteCourse(id: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/courses/${id}`);
  }
}
