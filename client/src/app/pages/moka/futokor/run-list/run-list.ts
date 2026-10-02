import { Component, computed, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FutokorCourse, FutokorRun, racePace, raceTime } from '../../../../services/futokor';

const STATUS_TEXT: Record<string, string> = {
  running: 'fut',
  finished: 'célba ért',
  gave_up: 'feladta',
  abandoned: 'újrakezdte',
  expired: 'lejárt',
};

// Someone's runs on a course, one under the other: the time, how it ended,
// the pace - and, on a tap, the run's splits from card to card.
@Component({
  selector: 'app-run-list',
  imports: [DatePipe, MatIconModule],
  templateUrl: './run-list.html',
  styleUrl: './run-list.scss',
})
export class RunList {
  runs = input.required<FutokorRun[]>();
  // For the cards' names in the splits.
  course = input<FutokorCourse | null>(null);

  // The run whose splits are open (by its start).
  open = signal<string | null>(null);

  rows = computed(() => {
    const checkpoints = this.course()?.checkpoints ?? [];
    const label = (id: string) => {
      const c = checkpoints.find((cp) => cp.id === id);
      return !c ? id : c.kind === 'startFinish' ? 'RAJT' : c.label;
    };
    return this.runs().map((r) => ({
      ...r,
      statusText: STATUS_TEXT[r.status] ?? r.status,
      time: r.status === 'finished' ? raceTime(r.totalMs) : '–',
      pace: r.paceSecPerKm ? racePace(r.paceSecPerKm) : '',
      legs: r.splits.map((s, i) => ({
        from: label(s.fromCheckpointId),
        // The last stretch of a finished run ends at the same card it
        // started from: the FINISH.
        to: r.status === 'finished' && i === r.splits.length - 1 ? 'CÉL' : label(s.toCheckpointId),
        time: raceTime(s.ms),
        distance: s.distanceM != null ? `${Math.round(s.distanceM)} m` : '',
        pace: s.paceSecPerKm ? racePace(s.paceSecPerKm) : '',
      })),
    }));
  });

  toggle(startedAt: string) {
    this.open.set(this.open() === startedAt ? null : startedAt);
  }
}
