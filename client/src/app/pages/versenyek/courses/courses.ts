import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../shared/errors';
import { FutokorCourse, FutokorService, FutokorTag } from '../../../services/futokor';
import { Tour, TourService } from '../../../services/tour';

// A course being changed: what the form holds.
interface Draft {
  name: string;
  opensAt: string; // as a datetime-local input has it
  closesAt: string;
  distanceM: string;
  maxRunDurationMin: string;
  startTagId: string;
  stops: { tagId: string; distanceAlongM: string }[];
}

// A date as a datetime-local input wants it ("2026-10-03T14:30", local
// time) - and back.
const toInput = (iso: string | Date) => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};
const fromInput = (value: string) => new Date(value).toISOString();
const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

// Versenyek → Pályák (admins): a tour's course - when it's open, how long
// the loop is, and which card is which checkpoint, in the order they're
// passed. One per tour; a trial one can be deleted with everything run on it.
@Component({
  selector: 'app-futokor-courses',
  imports: [RouterLink, DatePipe, MatIconModule],
  templateUrl: './courses.html',
  styleUrl: '../admin.scss',
})
export class FutokorCourses {
  private futokor = inject(FutokorService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);

  courses = signal<FutokorCourse[]>([]);
  tags = signal<FutokorTag[]>([]);
  tours = signal<Tour[]>([]);

  // The new course's form: by default open from now until tomorrow evening.
  newTourId = signal('');
  newOpensAt = signal(toInput(new Date()));
  newClosesAt = signal(toInput(new Date(Date.now() + 36 * 3600 * 1000)));

  // The course being changed, and its form.
  openId = signal<string | null>(null);
  draft = signal<Draft | null>(null);

  startTags = computed(() => this.tags().filter((t) => t.kind === 'startFinish' && !t.retired));
  stopTags = computed(() => this.tags().filter((t) => t.kind === 'checkpoint' && !t.retired));
  // The tours that have no course yet, the latest first.
  freeTours = computed(() => {
    const taken = new Set(this.courses().map((c) => c.tour._id));
    return this.tours()
      .filter((t) => !taken.has(t._id))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  });

  constructor() {
    this.load();
    this.futokor.getTags().subscribe({ next: (tags) => this.tags.set(tags), error: () => {} });
    inject(TourService)
      .getTours()
      .subscribe({ next: (res) => this.tours.set(res.data.tours), error: () => {} });
  }

  private load() {
    this.futokor.getCourses().subscribe({
      next: (courses) => this.courses.set(courses),
      error: (err) => this.fail(err, 'Nem sikerült betölteni a pályákat.'),
    });
  }

  private fail(err: unknown, fallback: string) {
    this.notifications.addError(errorMessage(err, fallback));
  }

  create() {
    if (!this.newTourId()) return;
    this.futokor
      .createCourse({
        tourId: this.newTourId(),
        opensAt: fromInput(this.newOpensAt()),
        closesAt: fromInput(this.newClosesAt()),
      })
      .subscribe({
        next: (course) => {
          this.newTourId.set('');
          this.load();
          this.toggle(course);
        },
        error: (err) => this.fail(err, 'Nem sikerült létrehozni a pályát.'),
      });
  }

  // Opens a course's form (or closes it).
  toggle(course: FutokorCourse) {
    if (this.openId() === course._id) {
      this.openId.set(null);
      this.draft.set(null);
      return;
    }
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
      })),
    });
  }

  // One field of the form.
  set<K extends keyof Draft>(key: K, value: Draft[K]) {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }

  setStop(i: number, key: 'tagId' | 'distanceAlongM', value: string) {
    this.draft.update((d) =>
      d ? { ...d, stops: d.stops.map((s, k) => (k === i ? { ...s, [key]: value } : s)) } : d,
    );
  }

  // The next card not on the course yet.
  addStop() {
    const d = this.draft();
    if (!d) return;
    const used = new Set(d.stops.map((s) => s.tagId));
    const free = this.stopTags().find((t) => !used.has(t.tagId));
    if (!free) {
      this.notifications.addError('Nincs több szabad kártya – készíts újat a Kártyák oldalon.');
      return;
    }
    this.set('stops', [...d.stops, { tagId: free.tagId, distanceAlongM: '' }]);
  }

  removeStop(i: number) {
    const d = this.draft();
    if (d)
      this.set(
        'stops',
        d.stops.filter((_, k) => k !== i),
      );
  }

  // Up (-1) or down (+1) in the order.
  moveStop(i: number, by: number) {
    const d = this.draft();
    if (!d || i + by < 0 || i + by >= d.stops.length) return;
    const stops = [...d.stops];
    [stops[i], stops[i + by]] = [stops[i + by], stops[i]];
    this.set('stops', stops);
  }

  save(course: FutokorCourse) {
    const d = this.draft();
    if (!d) return;
    this.futokor
      .updateCourse(course._id, {
        name: d.name,
        opensAt: fromInput(d.opensAt),
        closesAt: fromInput(d.closesAt),
        distanceM: numberOrNull(d.distanceM),
        maxRunDurationMin: numberOrNull(d.maxRunDurationMin),
        startTagId: d.startTagId,
        stops: d.stops.map((s) => ({
          tagId: s.tagId,
          distanceAlongM: numberOrNull(s.distanceAlongM),
        })),
      })
      .subscribe({
        next: () => {
          this.notifications.addSuccess('A pálya elmentve.');
          this.load();
          // The runners' phones get it the next time they open Futókör.
          void this.futokor.refresh();
        },
        error: (err) => this.fail(err, 'Nem sikerült elmenteni a pályát.'),
      });
  }

  async remove(course: FutokorCourse) {
    const ok = await this.confirm.ask({
      title: 'Törlöd a pályát?',
      message: `„${course.name}” – a rajta futott összes futás és leolvasás is törlődik. A kártyák megmaradnak.`,
    });
    if (!ok) return;
    this.futokor.deleteCourse(course._id).subscribe({
      next: () => {
        this.openId.set(null);
        this.draft.set(null);
        this.load();
        void this.futokor.refresh();
      },
      error: (err) => this.fail(err, 'Nem sikerült törölni a pályát.'),
    });
  }
}
