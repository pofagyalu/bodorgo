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

// A card, as whoever manages it sees it.
export interface FutokorTag {
  tagId: string;
  kind: 'startFinish' | 'checkpoint';
  retired: boolean;
  url: string; // what its QR code says
  createdAt: string;
}

// A course: a loop to run - everything the phone needs to run it offline.
// A tour's course (the admins', with the club's cards), or a user's own
// track (anyone's, with its own cards).
export interface FutokorCourse extends RuleCourse {
  _id: string;
  kind: 'tour' | 'own';
  tour: { _id: string; title?: string } | null;
  // Whoever made it - a user's own track is theirs to change.
  owner: { _id: string; name: string };
  canManage: boolean;
  name: string;
  opensAt: string;
  closesAt: string;
  // The loop to draw on the map: [lat, lng] pairs - empty if it has none.
  track?: [number, number][];
  elevationGainM?: number | null;
  // Its loop's GPX file is there to download.
  hasGpx?: boolean;
  // Only where the course is given to change (Pályaszerkesztő): a user's
  // own track's cards.
  cards?: FutokorTag[];
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

// A futókör in the list of them all.
export interface CourseSummary {
  _id: string;
  kind: 'tour' | 'own';
  name: string;
  tour: { _id: string; title?: string } | null;
  owner: { _id: string; name: string };
  opensAt: string;
  closesAt: string;
  distanceM: number | null;
  runners: number;
  finishedRuns: number;
  // On the course right now.
  runningNow: number;
  winner: { name: string; totalMs: number } | null;
}

// One futókör's results: every runner in the order of their best time
// (those who never finished after them), each with all their runs.
export interface CourseResults {
  course: FutokorCourse;
  runners: {
    userId: string;
    name: string;
    photoUpdatedAt: string | null;
    // To narrow the table by: the age group is ten years wide ("30-39") -
    // null if it isn't known.
    gender: 'férfi' | 'nő' | null;
    ageGroup: string | null;
    best: FutokorRun | null;
    finishedRuns: number;
    runs: FutokorRun[];
  }[];
}

// A point of a course as it's changed: how far along the loop it is, or
// where it is on the map (then the distance is measured along the track).
// `tagId`: a tour's course only - which of the club's cards hangs there.
export interface StopChange {
  tagId?: string;
  distanceAlongM?: number | null;
  lat?: number | null;
  lng?: number | null;
}

// What changing a course takes (see the server's updateCourse).
export interface CourseChanges {
  name?: string;
  opensAt?: string;
  closesAt?: string;
  maxRunDurationMin?: number | null;
  distanceM?: number | null;
  // A tour's course: its START/FINISH card.
  startTagId?: string;
  // A user's own track: how many points it has (its cards follow).
  points?: number;
  stops?: StopChange[];
}

// A scan waiting to be sent: made on the phone, uploaded when it can be.
interface QueuedScan {
  clientScanId: string;
  // The course the run is on.
  courseId: string;
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
// (futokor-course: the open courses - auth/moka.guard.ts looks for it.)
const COURSES_KEY = 'futokor-course';
const TOUR_COURSE_KEY = 'futokor-tour-course';
const SELECTED_KEY = 'futokor-selected';
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
// (Nothing to keep: the key goes.)
const save = (key: string, value: unknown) =>
  value == null || (Array.isArray(value) && !value.length)
    ? localStorage.removeItem(key)
    : localStorage.setItem(key, JSON.stringify(value));

// The courses kept on the phone - an earlier version of the app kept one.
function loadCourses(): FutokorCourse[] {
  const kept = load<FutokorCourse[] | FutokorCourse>(COURSES_KEY);
  return Array.isArray(kept) ? kept : kept ? [kept] : [];
}

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

// A card's id from the end of its link ("T05.k3J9xQ..." → "T05").
export const tagOfToken = (token: string) => {
  const dot = token.lastIndexOf('.');
  return dot > 0 ? token.slice(0, dot) : token;
};

const isOpenNow = (course: FutokorCourse, now = Date.now()) =>
  now >= Date.parse(course.opensAt) && now <= Date.parse(course.closesAt);

// Futókör: the running race. A runner's phone scans the cards; what each
// scan means is decided right here, with the server's own rules, so it
// works where there's no signal - the scans wait in a queue and go up when
// there's a connection, and the server's answer (worked out from all of the
// runner's scans) is the official one.
//
// Several courses can be open at once - a tour's, and users' own tracks:
// the phone keeps them all, and the START card that's scanned says which
// one a run is on.
@Injectable({ providedIn: 'root' })
export class FutokorService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/futokor`;

  // Every course open now, as the phone last had them (the tour's first).
  courses = signal<FutokorCourse[]>(loadCourses());
  // The tour's course: the open one - or the next to open.
  private tourCourse = signal<FutokorCourse | null>(load<FutokorCourse>(TOUR_COURSE_KEY));
  // The course picked on this phone (by its START card, or from the list).
  private selectedId = signal<string | null>(load<string>(SELECTED_KEY));

  // My latest run here, as this phone's own scans make it - and the course
  // it's on.
  private runState = signal<{ courseId: string; run: RuleRun } | null>(
    load<{ courseId: string; run: RuleRun }>(RUN_KEY),
  );
  run = computed(() => this.runState()?.run ?? null);

  // The course on the screen: the one a run is on; else the one picked;
  // else the tour's; else the only open one.
  course = computed<FutokorCourse | null>(() => {
    const all = this.courses();
    const tour = this.tourCourse();
    const byId = (id?: string | null) =>
      all.find((c) => c._id === id) ?? (tour?._id === id ? tour : null);
    const state = this.runState();
    if (state?.run.status === 'running') {
      const running = byId(state.courseId);
      if (running) return running;
    }
    return byId(this.selectedId()) ?? tour ?? (all.length === 1 ? all[0] : null);
  });

  private queue = signal<QueuedScan[]>(load<QueuedScan[]>(QUEUE_KEY) ?? []);
  // My runs as the server has them, by course - once it has answered.
  private allRuns = signal<Record<string, FutokorRun[]>>({});
  serverRuns = computed(() => this.allRuns()[this.course()?._id ?? ''] ?? []);
  // All of them, on every open course, the latest first - each with the
  // course it was on.
  myRuns = computed(() =>
    this.courses()
      .flatMap((course) => (this.allRuns()[course._id] ?? []).map((run) => ({ course, run })))
      .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt)),
  );
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

  // The courses to run and my runs on them, fresh from the server - and the
  // queue sent on the way. Without a connection what's on the phone stays.
  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{
          data: {
            course: FutokorCourse | null;
            courses?: FutokorCourse[];
            runs: FutokorRun[];
            allRuns?: Record<string, FutokorRun[]>;
            runner: { name: string };
          };
        }>(`${this.apiUrl}/active`),
      );
      const { course, courses, runs, allRuns, runner } = res.data;
      this.setCourses(courses ?? (course ? [course] : []), course);
      this.me.set({ name: runner.name });
      save(ME_KEY, this.me());
      if (!this.codeRunner()) {
        this.allRuns.set(allRuns ?? (course ? { [course._id]: runs } : {}));
      }
    } catch (err) {
      // Nobody is logged in here (or not someone who is in yet): the
      // courses are everyone's to get - they run with a futókód. Without a
      // connection what's on the phone stays as it is.
      if (err instanceof HttpErrorResponse && [401, 403].includes(err.status)) {
        this.me.set(null);
        save(ME_KEY, null);
        await this.loadPublicCourses();
      }
    }
    await this.sync();
  }

  private async loadPublicCourses() {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { course: FutokorCourse | null; courses?: FutokorCourse[] } }>(
          `${this.apiUrl}/course`,
        ),
      );
      const { course, courses } = res.data;
      this.setCourses(courses ?? (course ? [course] : []), course);
    } catch {
      // Offline.
    }
  }

  private setCourses(courses: FutokorCourse[], tourCourse: FutokorCourse | null) {
    this.courses.set(courses);
    save(COURSES_KEY, courses);
    this.tourCourse.set(tourCourse);
    save(TOUR_COURSE_KEY, tourCourse);
    // A run on a course that's gone (deleted, closed) isn't on any more.
    const state = this.runState();
    const known = (id: string) => courses.some((c) => c._id === id) || tourCourse?._id === id;
    if (state && !known(state.courseId)) this.setRun(null);
    if (this.selectedId() && !known(this.selectedId()!)) this.select(null);
  }

  // The course picked to show (and to start on) - not while a run is on.
  select(courseId: string | null) {
    this.selectedId.set(courseId);
    save(SELECTED_KEY, courseId);
  }

  // The open course a card is on - null if it's on none of them.
  courseOfCard(token: string): FutokorCourse | null {
    const tagId = tagOfToken(token);
    return (
      this.courses().find((c) => isOpenNow(c) && c.checkpoints.some((p) => p.tagId === tagId)) ??
      null
    );
  }

  // A card was read: with no run on, the course it belongs to becomes the
  // one on the screen - its START card starts a run there.
  prepare(token: string) {
    if (this.run()?.status === 'running') return;
    const course = this.courseOfCard(token);
    if (course && course._id !== this.course()?._id) this.select(course._id);
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
      this.allRuns.set({});
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
    this.allRuns.set({});
    void this.refresh();
  }

  // A card's link was opened, or its QR code read: the end of that link.
  scan(token: string, action?: 'restart'): ScanAnswer {
    this.prepare(token);
    return this.apply({ token, tagId: tagOfToken(token), action });
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
    if (!isOpenNow(course, now)) return { result: 'closed', run: this.run() };

    // (A run kept from another course isn't this one's.)
    const state = this.runState();
    const current = state?.courseId === course._id ? state.run : null;
    const clientScanId = crypto.randomUUID();
    const { run, outcome } = applyScan(course, current, {
      clientScanId,
      tagId: input.tagId,
      time: now,
      action: input.action ?? null,
    });
    // Only what counted goes to the server - it would refuse the rest the
    // same way.
    if (['started', 'passed', 'finished', 'gaveUp'].includes(outcome.result)) {
      this.setRun(run ? { courseId: course._id, run } : null);
      this.setQueue([
        ...this.queue(),
        {
          clientScanId,
          courseId: course._id,
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
    const state = this.runState();
    if (course && state?.courseId === course._id && isExpired(course, state.run, Date.now())) {
      this.setRun({ courseId: course._id, run: { ...state.run, status: 'expired' } });
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
        // The lists on the screen are the current runner's.
        if (runnerCode === this.codeRunner()?.code) {
          this.allRuns.update((all) => ({
            ...all,
            ...Object.fromEntries(res.data.runs.map((r) => [r.courseId, r.runs])),
          }));
        }
        if (!answered.size) break;
      }
    } catch {
      // Still offline, or the session has run out: they stay in the queue.
    } finally {
      this.syncing.set(false);
    }
  }

  private setRun(state: { courseId: string; run: RuleRun } | null) {
    this.runState.set(state);
    save(RUN_KEY, state);
  }

  private setQueue(queue: QueuedScan[]) {
    this.queue.set(queue);
    save(QUEUE_KEY, queue);
  }

  // --- Results ---

  getResults(): Observable<CourseSummary[]> {
    return this.http
      .get<{ data: { courses: CourseSummary[] } }>(`${this.apiUrl}/results`)
      .pipe(map((res) => res.data.courses));
  }

  getCourseResults(courseId: string): Observable<CourseResults> {
    return this.http
      .get<{ data: CourseResults }>(`${this.apiUrl}/courses/${courseId}/results`)
      .pipe(map((res) => res.data));
  }

  // --- The club's cards (admins) ---

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

  // --- Pályaszerkesztő: the courses I can change ---

  private one = (res: { data: { course: FutokorCourse } }) => res.data.course;

  // My own tracks - for an admin every course, the tours' too.
  getCourses(): Observable<FutokorCourse[]> {
    return this.http
      .get<{ data: { courses: FutokorCourse[] } }>(`${this.apiUrl}/courses`)
      .pipe(map((res) => res.data.courses));
  }

  // A tour's course (admins): its cards are chosen afterwards.
  createTourCourse(body: { tourId: string; opensAt: string; closesAt: string }) {
    return this.http
      .post<{ data: { course: FutokorCourse } }>(`${this.apiUrl}/courses`, body)
      .pipe(map(this.one));
  }

  // My own track: its cards are made with it.
  createOwnTrack(body: { name: string; points: number }) {
    return this.http
      .post<{ data: { course: FutokorCourse } }>(`${this.apiUrl}/courses`, body)
      .pipe(map(this.one));
  }

  updateCourse(id: string, changes: CourseChanges): Observable<FutokorCourse> {
    return this.http
      .patch<{ data: { course: FutokorCourse } }>(`${this.apiUrl}/courses/${id}`, changes)
      .pipe(map(this.one));
  }

  // The course's loop from a GPX file (a watch's recording, a planned route).
  uploadTrack(id: string, file: File): Observable<FutokorCourse> {
    const form = new FormData();
    form.append('gpx', file);
    return this.http
      .put<{ data: { course: FutokorCourse } }>(`${this.apiUrl}/courses/${id}/track`, form)
      .pipe(map(this.one));
  }

  removeTrack(id: string): Observable<FutokorCourse> {
    return this.http
      .delete<{ data: { course: FutokorCourse } }>(`${this.apiUrl}/courses/${id}/track`)
      .pipe(map(this.one));
  }

  deleteCourse(id: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/courses/${id}`);
  }

  // Plain links again: a user's own track's cards to print, and a course's
  // GPX file to download.
  sheetUrl = (id: string) => `${this.apiUrl}/courses/${id}/sheet`;
  gpxUrl = (id: string) => `${this.apiUrl}/courses/${id}/track.gpx`;
}
