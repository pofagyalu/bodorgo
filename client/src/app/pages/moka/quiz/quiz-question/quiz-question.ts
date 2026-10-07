import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  ANSWER_SHAPES,
  QuizBounds,
  QuizPlace,
  QuizQuestionType,
  QuizService,
} from '../../../../services/quiz';
import { MapGuess, QuizMap } from '../quiz-map/quiz-map';
import { QuizShape } from '../quiz-shape/quiz-shape';

// A question as it's shown: what everyone may see while it's open, and -
// once it's closed - the answer too.
export interface ShownQuestion {
  type: QuizQuestionType;
  text: string;
  answers: string[];
  image?: string | null;
  focus?: { x: number; y: number } | null;
  bounds?: QuizBounds | null;
  // Only once it's closed:
  correct?: number;
  counts?: number[];
  place?: QuizPlace | null;
  song?: { title?: string; artist?: string } | null;
}

// A picture question's picture is under this many tiles (8 x 6, see
// quiz-question.scss), which go one by one - the last one this far into
// the question's time, so the whole picture is there for the end. A zoom
// question's picture is whole by then too.
const TILES = 48;
const SHOWN_BY = 0.85;
// How many times its size a zoom question's picture starts at.
const ZOOM_START = 10;

// 0..count-1 shuffled, the same way for the same seed: every phone takes
// the tiles off in the same order.
function shuffled(count: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const random = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Móka → Kvíz: one question on the screen - in a game (quiz-game) and in
// the editor's preview (quiz-edit/quiz-preview) alike, so what's tried
// there is what the players get. Its text; what its kind has - a picture
// uncovered tile by tile or zoomed out of, a map to put a pin on, a sign
// that a song is playing -; and the answers to tap. It only shows what
// it's given and says what was tapped: the clock (`timeLeft`), who may
// answer and what an answer is worth are its user's.
@Component({
  selector: 'app-quiz-question',
  imports: [MatIconModule, QuizMap, QuizShape],
  templateUrl: './quiz-question.html',
  styleUrl: './quiz-question.scss',
})
export class QuizQuestionView {
  private quiz = inject(QuizService);
  readonly shapes = ANSWER_SHAPES;

  question = input.required<ShownQuestion>();
  // Still open - or closed, with the answer shown.
  open = input(true);
  // How much of the time is left, 1 → 0.
  timeLeft = input(1);
  // What the tiles' order is made from - the same on every phone.
  seed = input('');
  // What I tapped; on a map question, where my pin is.
  myAnswer = input<number | null>(null);
  myGuess = input<QuizPlace | null>(null);
  canAnswer = input(false);
  // A map question, once it's closed: everyone's pins.
  guesses = input<MapGuess[]>([]);
  answered = output<number>();
  pinned = output<QuizPlace>();

  imageUrl = (name: string) => this.quiz.imageUrl(name);

  // How far the showing of a picture has got, 0 → 1.
  private shown = computed(() => (this.open() ? Math.min(1, (1 - this.timeLeft()) / SHOWN_BY) : 1));

  // Each tile's turn to go (0: the first) - its own order for each question.
  tileTurns = computed(() =>
    this.question().type === 'picture' ? shuffled(TILES, this.seed()) : [],
  );
  // How many tiles are off by now.
  tilesGone = computed(() => Math.floor(this.shown() * TILES));

  // A zoom question: how many times its size the picture is right now -
  // backing away evenly to the eye (each moment by the same ratio).
  zoomScale = computed(() => Math.round(ZOOM_START ** (1 - this.shown()) * 1000) / 1000);
  // The detail it starts on stays where it is while the rest comes in.
  zoomOrigin = computed(() => {
    const { x = 0.5, y = 0.5 } = this.question().focus ?? {};
    return `${x * 100}% ${y * 100}%`;
  });

  // The most taps an answer got - the bars are measured against it.
  private mostTaps = computed(() => Math.max(1, ...(this.question().counts ?? [])));

  // How wide an answer's bar is once the question is closed, in percent.
  barWidth(idx: number): number {
    return Math.round(((this.question().counts?.[idx] ?? 0) / this.mostTaps()) * 100);
  }
}
