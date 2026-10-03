import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../../auth/auth.service';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../../shared/errors';
import { FutokorCourse, FutokorService, FutokorTag } from '../../../../services/futokor';
import { Tour, TourService } from '../../../../services/tour';
import { CourseMap } from '../course-map/course-map';
import { canNfc } from '../nfc/nfc';
import { NfcWrite } from '../nfc/nfc-write';

// A point of the course being changed: what the form holds.
interface DraftStop {
  tagId: string;
  distanceAlongM: string;
  lat: number | null;
  lng: number | null;
}

// A course being changed: what the form holds.
interface Draft {
  name: string;
  opensAt: string; // as a datetime-local input has it
  closesAt: string;
  distanceM: string;
  maxRunDurationMin: string;
  // A tour's course: its START/FINISH card (a user's own track has its own).
  startTagId: string;
  stops: DraftStop[];
}

const MAX_OWN_POINTS = 20;

// A date as a datetime-local input wants it ("2026-10-03T14:30", local
// time) - and back.
const toInput = (iso: string | Date) => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};
const fromInput = (value: string) => new Date(value).toISOString();
const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

// Móka → Futókörök → Pályaszerkesztő: where the courses are made and set
// up - not run. Anyone makes their own tracks here and owns them: the name
// and when it's open, the loop from a GPX file, the points put on the map,
// the cards to print. The admins do the same for a tour's course, which
// uses the club's cards (Kártyák) instead of its own.
@Component({
  selector: 'app-futokor-editor',
  imports: [DatePipe, MatIconModule, CourseMap, NfcWrite],
  templateUrl: './editor.html',
  styleUrl: '../admin.scss',
})
export class FutokorEditor {
  private futokor = inject(FutokorService);
  private notifications = inject(NotificationsService);
  readonly canNfc = canNfc();
  private confirm = inject(ConfirmService);

  readonly isAdmin = inject(AuthService).user()?.role === 'admin';
  readonly maxPoints = MAX_OWN_POINTS;

  courses = signal<FutokorCourse[]>([]);
  // The club's cards and the tours - for a tour's course (admins).
  tags = signal<FutokorTag[]>([]);
  tours = signal<Tour[]>([]);

  // A new track of my own.
  newName = signal('');
  newPoints = signal(3);

  // A new tour's course (admins): by default open from now until tomorrow
  // evening.
  newTourId = signal('');
  newOpensAt = signal(toInput(new Date()));
  newClosesAt = signal(toInput(new Date(Date.now() + 36 * 3600 * 1000)));

  // The course being changed, and its form.
  openId = signal<string | null>(null);
  draft = signal<Draft | null>(null);
  // The point a tap on the map places (its place among the stops, from 0).
  placing = signal(0);
  busy = signal(false);

  startTags = computed(() => this.tags().filter((t) => t.kind === 'startFinish' && !t.retired));
  stopTags = computed(() => this.tags().filter((t) => t.kind === 'checkpoint' && !t.retired));
  // The tours that have no course yet, the latest first.
  freeTours = computed(() => {
    const taken = new Set(this.courses().map((c) => c.tour?._id));
    return this.tours()
      .filter((t) => !taken.has(t._id))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  });

  // The open course as the form now has it - what the map shows.
  preview = computed<FutokorCourse | null>(() => {
    const course = this.courses().find((c) => c._id === this.openId());
    const d = this.draft();
    if (!course || !d) return null;
    const start = course.checkpoints.find((c) => c.kind === 'startFinish');
    return {
      ...course,
      checkpoints: [
        ...(start ? [start] : []),
        ...d.stops.map((s, i) => ({
          id: s.tagId,
          tagId: s.tagId,
          kind: 'checkpoint' as const,
          label: `${i + 1}. pont`,
          order: i + 1,
          distanceAlongM: numberOrNull(s.distanceAlongM),
          lat: s.lat,
          lng: s.lng,
        })),
      ],
    };
  });
  hasTrack = computed(() => (this.preview()?.track?.length ?? 0) > 1);

  constructor() {
    this.load();
    if (this.isAdmin) {
      this.futokor.getTags().subscribe({ next: (tags) => this.tags.set(tags), error: () => {} });
      inject(TourService)
        .getTours()
        .subscribe({ next: (res) => this.tours.set(res.data.tours), error: () => {} });
    }
  }

  private load() {
    this.futokor.getCourses().subscribe({
      next: (courses) => this.courses.set(courses),
      error: (err) => this.fail(err, 'Nem sikerült betölteni a pályákat.'),
    });
  }

  private fail(err: unknown, fallback: string) {
    this.busy.set(false);
    this.notifications.addError(errorMessage(err, fallback));
  }

  sheetUrl = (course: FutokorCourse) => this.futokor.sheetUrl(course._id);
  gpxUrl = (course: FutokorCourse) => this.futokor.gpxUrl(course._id);

  // The course as the server now has it: into the list and into the form.
  private saved(course: FutokorCourse, message?: string) {
    this.busy.set(false);
    this.courses.update((list) =>
      list.some((c) => c._id === course._id)
        ? list.map((c) => (c._id === course._id ? course : c))
        : [course, ...list],
    );
    this.open(course);
    if (message) this.notifications.addSuccess(message);
    // The runners' phones get it the next time they open Futókörök.
    void this.futokor.refresh();
  }

  // --- New courses ---

  createOwn() {
    const name = this.newName().trim();
    if (!name) return;
    this.futokor.createOwnTrack({ name, points: this.newPoints() }).subscribe({
      next: (course) => {
        this.newName.set('');
        this.saved(course, 'A pálya elkészült – jöhet a nyomvonal és a kártyák.');
      },
      error: (err) => this.fail(err, 'Nem sikerült létrehozni a pályát.'),
    });
  }

  createForTour() {
    if (!this.newTourId()) return;
    this.futokor
      .createTourCourse({
        tourId: this.newTourId(),
        opensAt: fromInput(this.newOpensAt()),
        closesAt: fromInput(this.newClosesAt()),
      })
      .subscribe({
        next: (course) => {
          this.newTourId.set('');
          this.saved(course);
        },
        error: (err) => this.fail(err, 'Nem sikerült létrehozni a pályát.'),
      });
  }

  // --- The form of the course being changed ---

  toggle(course: FutokorCourse) {
    if (this.openId() === course._id) {
      this.openId.set(null);
      this.draft.set(null);
    } else {
      this.open(course);
    }
  }

  private open(course: FutokorCourse) {
    const stops = course.checkpoints.filter((c) => c.kind === 'checkpoint');
    this.openId.set(course._id);
    this.draft.set({
      name: course.name,
      opensAt: toInput(course.opensAt),
      closesAt: toInput(course.closesAt),
      distanceM: course.distanceM ? String(course.distanceM) : '',
      maxRunDurationMin: String(course.maxRunDurationMin ?? ''),
      startTagId:
        course.checkpoints.find((c) => c.kind === 'startFinish')?.tagId ??
        this.startTags()[0]?.tagId ??
        '',
      stops: stops.map((c) => ({
        tagId: c.tagId,
        distanceAlongM: c.distanceAlongM ? String(c.distanceAlongM) : '',
        lat: c.lat ?? null,
        lng: c.lng ?? null,
      })),
    });
    // The first point without a place is the one to put down next.
    const unplaced = stops.findIndex((c) => c.lat == null);
    this.placing.set(unplaced === -1 ? 0 : unplaced);
  }

  // One field of the form.
  set<K extends keyof Draft>(key: K, value: Draft[K]) {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }

  private setStop(i: number, changes: Partial<DraftStop>) {
    this.draft.update((d) =>
      d ? { ...d, stops: d.stops.map((s, k) => (k === i ? { ...s, ...changes } : s)) } : d,
    );
  }

  setStopCard(i: number, tagId: string) {
    this.setStop(i, { tagId });
  }

  setStopDistance(i: number, value: string) {
    this.setStop(i, { distanceAlongM: value });
  }

  // A tap on the map: the point being placed goes there - and the next one
  // without a place is up.
  onPicked(at: { lat: number; lng: number }) {
    const d = this.draft();
    if (!d?.stops.length) return;
    const i = Math.min(this.placing(), d.stops.length - 1);
    this.setStop(i, { ...at, distanceAlongM: '' });
    const next = d.stops.findIndex((s, k) => k !== i && s.lat === null);
    this.placing.set(next === -1 ? Math.min(i + 1, d.stops.length - 1) : next);
  }

  // A point dragged somewhere else (`order`: 1 for the first).
  onMoved(to: { order: number; lat: number; lng: number }) {
    this.setStop(to.order - 1, { lat: to.lat, lng: to.lng, distanceAlongM: '' });
  }

  clearPlace(i: number) {
    this.setStop(i, { lat: null, lng: null });
    this.placing.set(i);
  }

  // A user's own track: one point more or fewer (its cards follow when
  // it's saved).
  changePoints(course: FutokorCourse, by: number) {
    const d = this.draft();
    if (!d) return;
    const count = d.stops.length + by;
    if (count < 1 || count > MAX_OWN_POINTS) return;
    this.set(
      'stops',
      by > 0
        ? [...d.stops, { tagId: '', distanceAlongM: '', lat: null, lng: null }]
        : d.stops.slice(0, -1),
    );
    this.placing.set(Math.min(this.placing(), count - 1));
  }

  // A tour's course: the next of the club's cards not on it yet.
  addStop() {
    const d = this.draft();
    if (!d) return;
    const used = new Set(d.stops.map((s) => s.tagId));
    const free = this.stopTags().find((t) => !used.has(t.tagId));
    if (!free) {
      this.notifications.addError('Nincs több szabad kártya – készíts újat a Kártyák oldalon.');
      return;
    }
    this.set('stops', [
      ...d.stops,
      { tagId: free.tagId, distanceAlongM: '', lat: null, lng: null },
    ]);
  }

  removeStop(i: number) {
    const d = this.draft();
    if (d) {
      this.set(
        'stops',
        d.stops.filter((_, k) => k !== i),
      );
    }
  }

  // A tour's course: a point one earlier in the order (its place on the map
  // stays with the order: the 2nd point is where it was).
  moveStopUp(i: number) {
    const d = this.draft();
    if (!d || i < 1) return;
    const stops = d.stops.map((s) => ({ ...s }));
    [stops[i - 1].tagId, stops[i].tagId] = [stops[i].tagId, stops[i - 1].tagId];
    this.set('stops', stops);
  }

  save(course: FutokorCourse) {
    const d = this.draft();
    if (!d || this.busy()) return;
    this.busy.set(true);
    const own = course.kind === 'own';
    // With the loop on the course, a point that has a place gets its
    // distance from it - the typed distance is for the points without one.
    const stops = d.stops.map((s) => ({
      ...(own ? {} : { tagId: s.tagId }),
      lat: s.lat,
      lng: s.lng,
      distanceAlongM: numberOrNull(s.distanceAlongM),
    }));
    this.futokor
      .updateCourse(course._id, {
        name: d.name,
        opensAt: fromInput(d.opensAt),
        closesAt: fromInput(d.closesAt),
        distanceM: numberOrNull(d.distanceM),
        maxRunDurationMin: numberOrNull(d.maxRunDurationMin),
        ...(own ? { points: stops.length } : { startTagId: d.startTagId }),
        stops,
      })
      .subscribe({
        next: (saved) => this.saved(saved, 'A pálya elmentve.'),
        error: (err) => this.fail(err, 'Nem sikerült elmenteni a pályát.'),
      });
  }

  // --- The loop: a GPX file ---

  onGpx(course: FutokorCourse, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.futokor.uploadTrack(course._id, file).subscribe({
      next: (saved) =>
        this.saved(
          saved,
          `A nyomvonal feltöltve: ${saved.distanceM} m. Most tedd a helyükre a pontokat.`,
        ),
      error: (err) => this.fail(err, 'Nem sikerült feltölteni a GPX fájlt.'),
    });
  }

  async removeTrack(course: FutokorCourse) {
    const ok = await this.confirm.ask({
      message: 'Leveszed a nyomvonalat a pályáról? A pontok helye és távolsága megmarad.',
      confirmText: 'Leveszem',
    });
    if (!ok) return;
    this.futokor.removeTrack(course._id).subscribe({
      next: (saved) => this.saved(saved),
      error: (err) => this.fail(err, 'Nem sikerült.'),
    });
  }

  async remove(course: FutokorCourse) {
    const ok = await this.confirm.ask({
      title: 'Törlöd a pályát?',
      message: `„${course.name}” – a rajta futott összes futás és leolvasás is törlődik${
        course.kind === 'own' ? ', és a kártyái sem érnek többé semmit' : '. A kártyák megmaradnak'
      }.`,
    });
    if (!ok) return;
    this.futokor.deleteCourse(course._id).subscribe({
      next: () => {
        this.openId.set(null);
        this.draft.set(null);
        this.courses.update((list) => list.filter((c) => c._id !== course._id));
        void this.futokor.refresh();
      },
      error: (err) => this.fail(err, 'Nem sikerült törölni a pályát.'),
    });
  }
}
