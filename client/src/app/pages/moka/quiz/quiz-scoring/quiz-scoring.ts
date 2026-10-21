import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { errorMessage } from '../../../../shared/errors';
import {
  DEFAULT_BOUNDS,
  QuizScoring,
  QuizScoringView,
  QuizService,
  diagonalKm,
} from '../../../../services/quiz';

// The limits of what can be set (the server checks the same).
const MIN_LAST_POINTS = 100;
const MIN_MAP_REACH = 10;
const MAX_MAP_REACH = 100;

const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
// What is wrong with a field, in words under it - '' when nothing.
const problem = (n: number, min: number, max: number, unit: string) =>
  !Number.isInteger(n)
    ? 'Egész számot írj be.'
    : n < min
      ? `Legalább ${min}${unit} legyen.`
      : n > max
        ? `Legfeljebb ${max}${unit} lehet.`
        : '';
const same = (a: QuizScoring, b: QuizScoring) =>
  a.minPoints === b.minPoints &&
  a.mapReachPct === b.mapReachPct &&
  a.streakBonus === b.streakBonus &&
  a.orderBonus.every((v, i) => v === b.orderBonus[i]);

// Móka → Kvíz → Pontozás: what an answer is worth. Everyone may read it;
// the role manager sets it - for the games still to start: one already on,
// and every one played, keeps the scoring it was started with.
@Component({
  selector: 'app-quiz-scoring',
  imports: [DatePipe, MatIconModule],
  templateUrl: './quiz-scoring.html',
  styleUrl: './quiz-scoring.scss',
})
export class QuizScoringPage {
  private quiz = inject(QuizService);
  private notifications = inject(NotificationsService);

  readonly places = ['Leggyorsabb', '2. leggyorsabb', '3. leggyorsabb'];
  readonly minMapReach = MIN_MAP_REACH;
  readonly maxMapReach = MAX_MAP_REACH;

  // null: still loading (or it couldn't be loaded).
  view = signal<QuizScoringView | null>(null);
  // What is in the fields - an empty one is NaN.
  draft = signal<QuizScoring | null>(null);
  saving = signal(false);

  canEdit = computed(() => !!this.view()?.canEdit);
  max = computed(() => this.view()?.maxPoints ?? 1000);

  // What is wrong with each field.
  problems = computed(() => {
    const d = this.draft();
    if (!d) return null;
    const max = this.max();
    return {
      minPoints: problem(d.minPoints, MIN_LAST_POINTS, max, ' pont'),
      // A faster one never gets less than the one after it.
      orderBonus: d.orderBonus.map(
        (b, i) =>
          problem(b, 0, max, ' pont') ||
          (i < 2 && whole(d.orderBonus[i + 1], 0, max) && b < d.orderBonus[i + 1]
            ? `Nem lehet kevesebb, mint a ${this.places[i + 1].toLowerCase()} bónusza.`
            : ''),
      ),
      mapReachPct: problem(d.mapReachPct, MIN_MAP_REACH, MAX_MAP_REACH, '%'),
      streakBonus: problem(d.streakBonus, 0, max, ' pont'),
    };
  });
  valid = computed(() => {
    const p = this.problems();
    return !!p && !p.minPoints && p.orderBonus.every((b) => !b) && !p.mapReachPct && !p.streakBonus;
  });
  changed = computed(() => {
    const d = this.draft();
    const stored = this.view()?.scoring;
    return !!d && !!stored && !same(d, stored);
  });

  // Examples in words, from what is in the fields.
  // A right answer after a quarter, and after half, of the time.
  speedExample = computed(() => {
    const min = this.draft()?.minPoints ?? NaN;
    if (!whole(min, MIN_LAST_POINTS, this.max())) return null;
    const at = (used: number) => Math.round(this.max() - (this.max() - min) * used);
    return { quarter: at(0.25), half: at(0.5) };
  });
  // On the map a new question shows (Hungary): how many km that is.
  reachKm = computed(() => {
    const pct = this.draft()?.mapReachPct ?? NaN;
    if (!whole(pct, MIN_MAP_REACH, MAX_MAP_REACH)) return null;
    return Math.round((diagonalKm(DEFAULT_BOUNDS) * pct) / 100 / 10) * 10;
  });
  // What the 2nd, 3rd... right answer in a row gets.
  streakSteps = computed(() => {
    const bonus = this.draft()?.streakBonus ?? NaN;
    const steps = this.view()?.maxStreakSteps ?? 0;
    if (!whole(bonus, 1, this.max())) return [];
    return Array.from({ length: steps }, (_, i) => ({ nth: i + 2, bonus: bonus * (i + 1) }));
  });

  constructor() {
    this.quiz.getScoring().subscribe({
      next: (view) => this.show(view),
      error: (err) =>
        this.notifications.addError(errorMessage(err, 'Nem sikerült betölteni a pontozást.')),
    });
  }

  private show(view: QuizScoringView) {
    this.view.set(view);
    this.draft.set({ ...view.scoring, orderBonus: [...view.scoring.orderBonus] });
  }

  private number = (text: string) => (text.trim() === '' ? NaN : Number(text));

  set(field: 'minPoints' | 'mapReachPct' | 'streakBonus', text: string) {
    this.draft.update((d) => d && { ...d, [field]: this.number(text) });
  }

  setBonus(place: number, text: string) {
    this.draft.update(
      (d) =>
        d && {
          ...d,
          orderBonus: d.orderBonus.map((b, i) => (i === place ? this.number(text) : b)),
        },
    );
  }

  // Back to what is stored.
  reset() {
    const view = this.view();
    if (view) this.show(view);
  }

  save() {
    const draft = this.draft();
    if (!draft || !this.valid() || !this.changed() || this.saving()) return;
    this.saving.set(true);
    this.quiz.updateScoring(draft).subscribe({
      next: (view) => {
        this.saving.set(false);
        this.show(view);
        this.notifications.addSuccess(
          'Pontozás elmentve – a következő elindított játéktól érvényes.',
        );
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült elmenteni a pontozást.'));
      },
    });
  }
}
