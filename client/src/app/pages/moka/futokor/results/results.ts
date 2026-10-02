import { Component, computed, inject, signal } from '@angular/core';
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
import { CourseMap } from '../course-map/course-map';
import { RunList } from '../run-list/run-list';

// Móka → Futókörök → Eredmények: every futókör there has been (one per
// tour, the newest first) - and, with one opened (eredmenyek/<id>), its
// podium and everyone in the order of their best time; a tap on a runner
// shows all their runs, a tap on a run its splits.
@Component({
  selector: 'app-futokor-results',
  imports: [RouterLink, DatePipe, MatIconModule, Avatar, Podium, CourseMap, RunList],
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class FutokorResults {
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

  winners = computed<PodiumWinner[]>(() =>
    (this.results()?.runners ?? [])
      .filter((r) => r.best)
      .slice(0, 3)
      .map((r, i) => ({
        place: (i + 1) as 1 | 2 | 3,
        userId: r.userId,
        name: r.name,
        photoVersion: r.photoUpdatedAt,
      })),
  );
  hasMap = computed(() => (this.results()?.course.track?.length ?? 0) > 1);

  constructor() {
    const fail = () => this.failed.set(true);
    if (this.courseId) {
      this.futokor.getCourseResults(this.courseId).subscribe({
        next: (results) => {
          this.results.set(results);
          // My own runs are open to begin with.
          if (results.runners.some((r) => r.userId === this.myId)) {
            this.openRunner.set(this.myId ?? null);
          }
        },
        error: fail,
      });
    } else {
      this.futokor
        .getResults()
        .subscribe({ next: (courses) => this.courses.set(courses), error: fail });
    }
  }

  toggle(userId: string) {
    this.openRunner.set(this.openRunner() === userId ? null : userId);
  }
}
