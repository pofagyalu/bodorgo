import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  DEFAULT_BOUNDS,
  DEFAULT_SCORING,
  QuizBounds,
  QuizPlace,
  QuizQuestion,
  QuizService,
  diagonalKm,
  distanceKm,
} from '../../../../../services/quiz';
import { QuizQuestionView, ShownQuestion } from '../../quiz-question/quiz-question';

const TICK_MS = 200;
const TRUE_FALSE = ['Igaz', 'Hamis'];
const MAX_POINTS = 1000;

// What a pin that far off is worth (the server's jatekok/quiz/scoring.js):
// nothing from `reachPct` % of the shown map's diagonal away.
function mapPoints(km: number, b: QuizBounds, reachPct: number): number {
  return Math.round(MAX_POINTS * Math.max(0, 1 - km / ((diagonalKm(b) * reachPct) / 100)));
}

// What trying the question came to.
interface Outcome {
  kind: 'right' | 'wrong' | 'none' | 'far';
  points: number;
  km?: number;
}

// Móka → Kvíz → the editor: the open question as the players will get it
// - the very same view the game uses (quiz-question) -, to be tried on the
// spot, without a game: its own clock runs, the picture is uncovered, the
// song plays here, an answer can be tapped (or a pin put down), and it
// says what that would have been worth. Nothing is sent anywhere. A change
// to the question puts it back to its start.
@Component({
  selector: 'app-quiz-preview',
  imports: [MatIconModule, QuizQuestionView],
  templateUrl: './quiz-preview.html',
  styleUrl: './quiz-preview.scss',
})
export class QuizPreview implements OnDestroy {
  private quiz = inject(QuizService);

  // The question as it is in the editor (all four answer slots, empty ones
  // too).
  question = input.required<QuizQuestion>();
  // Which one of how many: "2 / 5".
  label = input('');

  // idle: at its start, waiting; running: the clock is on; done: closed,
  // with the answer shown.
  phase = signal<'idle' | 'running' | 'done'>('idle');
  myAnswer = signal<number | null>(null);
  myGuess = signal<QuizPlace | null>(null);
  outcome = signal<Outcome | null>(null);
  private startedAt = 0;
  private now = signal(0);
  private ticker: ReturnType<typeof setInterval> | undefined;
  private song: HTMLAudioElement | null = null;

  private limitMs = computed(() => this.question().timeLimitSec * 1000);
  // How much of the time is left, 1 → 0.
  timeLeft = computed(() => {
    if (this.phase() === 'idle') return 1;
    if (this.phase() === 'done') return 0;
    return Math.max(0, 1 - (this.now() - this.startedAt) / this.limitMs());
  });
  secondsLeft = computed(() => Math.ceil((this.timeLeft() * this.limitMs()) / 1000));

  // The answers the players get: the filled slots only, and the right
  // one's place among them.
  private answers = computed(() => {
    const q = this.question();
    if (q.type === 'map') return { answers: [], correct: 0 };
    if (q.type === 'truefalse') return { answers: TRUE_FALSE, correct: q.correct };
    const kept = q.answers.map((a, i) => ({ a: a.trim(), i })).filter((x) => x.a);
    return { answers: kept.map((x) => x.a), correct: kept.findIndex((x) => x.i === q.correct) };
  });

  // The question as the view takes it - the answer in it only once closed.
  shown = computed<ShownQuestion>(() => {
    const q = this.question();
    const { answers, correct } = this.answers();
    const done = this.phase() === 'done';
    return {
      type: q.type,
      text: q.text.trim() || 'A kérdés szövege…',
      answers,
      image: q.image,
      focus: q.focus,
      bounds: q.type === 'map' ? (q.bounds ?? DEFAULT_BOUNDS) : null,
      ...(done && { correct, place: q.place, song: q.song }),
    };
  });

  canAnswer = computed(
    () =>
      this.phase() === 'running' && (this.question().type === 'map' || this.myAnswer() === null),
  );

  // What a game started now would be scored with (Móka → Kvíz → Pontozás)
  // - the bonuses aside: those take other players.
  private scoring = signal(DEFAULT_SCORING);

  constructor() {
    this.quiz.getScoring().subscribe({
      next: (view) => this.scoring.set(view.scoring),
      // Without it the original scoring shows.
      error: () => {},
    });
    // The question was changed (or another one opened): back to its start.
    effect(() => {
      this.question();
      untracked(() => this.reset());
    });
  }

  ngOnDestroy() {
    this.stop();
  }

  private stop() {
    clearInterval(this.ticker);
    this.song?.pause();
    this.song = null;
  }

  reset() {
    this.stop();
    this.phase.set('idle');
    this.myAnswer.set(null);
    this.myGuess.set(null);
    this.outcome.set(null);
  }

  // The clock starts - and, on a song question, the song.
  start() {
    this.reset();
    this.startedAt = Date.now();
    this.now.set(this.startedAt);
    this.phase.set('running');
    this.ticker = setInterval(() => {
      this.now.set(Date.now());
      if (this.timeLeft() <= 0) this.finish();
    }, TICK_MS);

    const { type, song } = this.question();
    if (type === 'song' && song) {
      this.song = new Audio(this.quiz.trackUrl(song));
      try {
        void this.song.play()?.catch(() => {});
      } catch {
        // No sound here (the browser wouldn't play it): the rest still runs.
      }
    }
  }

  // An answer tapped: that closes it, as it would for a player.
  answer(idx: number) {
    if (!this.canAnswer()) return;
    this.myAnswer.set(idx);
    this.finish();
  }

  // A pin put down, or moved - it counts where it is when the time is up.
  putPin(place: QuizPlace) {
    if (this.canAnswer()) this.myGuess.set(place);
  }

  // Closed - by an answer, by the clock, or by the button: what it came to.
  // (The song plays on, as in a game, until the preview is started again
  // or left.)
  finish() {
    if (this.phase() !== 'running') return;
    const used = Math.min(1, (Date.now() - this.startedAt) / this.limitMs());
    clearInterval(this.ticker);
    const q = this.question();
    if (q.type === 'map') {
      const guess = this.myGuess();
      if (guess && q.place) {
        const km = distanceKm(q.place, guess);
        this.outcome.set({
          kind: 'far',
          km: Math.round(km * 10) / 10,
          points: mapPoints(km, q.bounds ?? DEFAULT_BOUNDS, this.scoring().mapReachPct),
        });
      } else {
        this.outcome.set({ kind: 'none', points: 0 });
      }
    } else if (this.myAnswer() === null) {
      this.outcome.set({ kind: 'none', points: 0 });
    } else if (this.myAnswer() === this.answers().correct) {
      // The faster, the more: from 1000 down to what the scoring sets.
      const min = this.scoring().minPoints;
      this.outcome.set({
        kind: 'right',
        points: Math.round(MAX_POINTS - (MAX_POINTS - min) * used),
      });
    } else {
      this.outcome.set({ kind: 'wrong', points: 0 });
    }
    this.phase.set('done');
  }
}
