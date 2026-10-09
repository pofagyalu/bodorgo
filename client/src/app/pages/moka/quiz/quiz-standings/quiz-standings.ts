import { Component, OnDestroy, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../../components/avatar/avatar';
import { QuizPlayer } from '../../../../services/quiz';

// How many are shown - and me, if I'm not among them.
const TOP = 8;
// A row's height, in rem (quiz-standings.scss: the rows are placed by it).
const ROW = 3.5;
// How long the standings stand as they were before the last question.
const BEFORE_MS = 900;
// ...and how long the bars have to grow before the rows change places.
const GROW_MS = 1400;

interface Row extends QuizPlayer {
  // What they had before the last question, and where that put them
  // among the rows shown (0: on top).
  before: number;
  beforePlace: number;
  place: number;
}

// Móka → Kvíz: how the game stands between two questions - everyone's
// points as bars. It opens as things were before the last question, then
// the bars grow by what that brought, and only then do the rows move to
// their new places - so who overtook whom is seen happening.
@Component({
  selector: 'app-quiz-standings',
  imports: [MatIconModule, Avatar],
  templateUrl: './quiz-standings.html',
  styleUrl: './quiz-standings.scss',
})
export class QuizStandings implements OnDestroy {
  // Best first, each with what the last question brought (`points`).
  players = input.required<QuizPlayer[]>();
  myId = input<string | undefined>(undefined);
  readonly rowHeight = ROW;

  // False: the points as they were before the last question; true: as
  // they are now.
  moved = signal(false);
  // False: everyone still in their place of before; true: in the new one.
  sorted = signal(false);
  private timers = [
    setTimeout(() => this.moved.set(true), BEFORE_MS),
    setTimeout(() => this.sorted.set(true), BEFORE_MS + GROW_MS),
  ];

  rows = computed<Row[]>(() => {
    const all = this.players();
    const shown = all.slice(0, TOP);
    const me = all.find((p) => p.userId === this.myId());
    if (me && !shown.includes(me)) shown.push(me);
    const before = (p: QuizPlayer) => p.score - (p.points ?? 0);
    // Who was where before: by the points they had then (ties as now).
    const earlier = [...shown].sort((a, b) => before(b) - before(a));
    return shown.map((p, place) => ({
      ...p,
      before: before(p),
      beforePlace: earlier.indexOf(p),
      place,
    }));
  });

  // The longest bar is the leader's.
  private most = computed(() => Math.max(1, ...this.rows().map((r) => r.score)));

  width(row: Row): number {
    return Math.round(((this.moved() ? row.score : row.before) / this.most()) * 100);
  }

  ngOnDestroy() {
    this.timers.forEach(clearTimeout);
  }
}
