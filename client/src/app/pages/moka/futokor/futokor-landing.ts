import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CourseSummary, FutokorService, racePace, raceTime } from '../../../services/futokor';

// Móka → Futókörök: the opening page (like Darts' own) - what this is, a
// picture of a loop with its cards and a runner going round, and the way
// in: "Futni indulok" leads to Futás. Under it, as on Darts' page: the
// results (every futókör, each on its own) and my own runs.
@Component({
  selector: 'app-futokor-landing',
  imports: [RouterLink, DatePipe, MatIconModule],
  templateUrl: './futokor-landing.html',
  styleUrl: './futokor-landing.scss',
})
export class FutokorLanding {
  private futokor = inject(FutokorService);

  readonly time = raceTime;
  readonly pace = racePace;
  readonly statusText: Record<string, string> = {
    running: 'fut',
    finished: 'célba ért',
    gave_up: 'feladta',
    abandoned: 'újrakezdte',
    expired: 'lejárt',
  };

  // Every futókör there has been, the newest first.
  results = signal<CourseSummary[]>([]);
  // My runs on the courses open now, the latest first.
  myRuns = this.futokor.myRuns;

  // The cards on the picture's loop: where each sits (the drawing's own
  // units), the START/FINISH first.
  readonly pins = [
    { x: 70, y: 196, label: 'R', start: true },
    { x: 96, y: 78, label: '1', start: false },
    { x: 232, y: 52, label: '2', start: false },
    { x: 330, y: 150, label: '3', start: false },
    { x: 214, y: 232, label: '4', start: false },
  ];

  // What's open to run right now, as the phone last knew it.
  open = computed(() => {
    const now = Date.now();
    return this.futokor
      .courses()
      .filter((c) => now >= Date.parse(c.opensAt) && now <= Date.parse(c.closesAt));
  });

  constructor() {
    void this.futokor.refresh();
    this.futokor
      .getResults()
      .subscribe({ next: (results) => this.results.set(results), error: () => {} });
  }
}
