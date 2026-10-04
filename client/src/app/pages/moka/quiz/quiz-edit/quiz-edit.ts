import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../../shared/errors';
import { shrinkImage } from '../../../../shared/image-resize';
import {
  ANSWER_SHAPES,
  DEFAULT_TIME_LIMIT,
  MAX_ANSWERS,
  MAX_QUESTIONS,
  MIN_ANSWERS,
  QuizDraft,
  QuizQuestion,
  QuizService,
  TIME_LIMITS,
} from '../../../../services/quiz';
import { PickedTourPhoto, QuizPhotoPicker } from './photo-picker/photo-picker';

// A question in the editor always has all four answer slots: one left
// empty simply isn't an answer (see toDraft).
const blankQuestion = (): QuizQuestion => ({
  text: '',
  image: null,
  answers: Array<string>(MAX_ANSWERS).fill(''),
  correct: 0,
  timeLimitSec: DEFAULT_TIME_LIMIT,
});

const filled = (answers: string[]) => answers.filter((a) => a.trim()).length;

// Móka → Kvíz → Kvízek → a new quiz, or one of my own: its title and its
// questions - each with up to four answers, the right one ticked, how
// long there is to think, and - for a picture question - a picture: one of
// my own, or a photo of a tour's album.
@Component({
  selector: 'app-quiz-edit',
  imports: [RouterLink, MatIconModule, QuizPhotoPicker],
  templateUrl: './quiz-edit.html',
  styleUrl: './quiz-edit.scss',
})
export class QuizEdit {
  private quiz = inject(QuizService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  // None: a new quiz.
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  readonly shapes = ANSWER_SHAPES;
  readonly timeLimits = TIME_LIMITS;

  title = signal('');
  questions = signal<QuizQuestion[]>([blankQuestion()]);
  loaded = signal(!this.id);
  saving = signal(false);
  // The question a tour's photo is being picked for (the picker is open).
  pickingFor = signal<number | null>(null);
  // The question whose picture is on its way to the server.
  uploadingFor = signal<number | null>(null);

  isFull = computed(() => this.questions().length >= MAX_QUESTIONS);

  // What still keeps it from being saved - the first thing, in words.
  problem = computed<string | null>(() => {
    if (!this.title().trim()) return 'Adj címet a kvíznek.';
    for (const [i, q] of this.questions().entries()) {
      const nr = `${i + 1}. kérdés`;
      if (!q.text.trim()) return `${nr}: írd be a kérdést.`;
      if (filled(q.answers) < MIN_ANSWERS) return `${nr}: legalább két válasz kell.`;
      if (!q.answers[q.correct].trim()) return `${nr}: a helyesnek jelölt válasz üres.`;
    }
    return null;
  });

  constructor() {
    if (!this.id) return;
    this.quiz.getQuiz(this.id).subscribe({
      next: (quiz) => {
        this.title.set(quiz.title);
        this.questions.set(
          (quiz.questions ?? []).map((q) => ({
            ...q,
            answers: [...q.answers, ...Array<string>(MAX_ANSWERS).fill('')].slice(0, MAX_ANSWERS),
          })),
        );
        this.loaded.set(true);
      },
      error: (err) => {
        this.notifications.addError(errorMessage(err, 'Nem sikerült betölteni a kvízt.'));
        this.router.navigate(['/moka/kviz/szerkeszto']);
      },
    });
  }

  private patch(idx: number, change: Partial<QuizQuestion>) {
    this.questions.update((list) => list.map((q, i) => (i === idx ? { ...q, ...change } : q)));
  }

  setText(idx: number, text: string) {
    this.patch(idx, { text });
  }

  setAnswer(idx: number, answerIdx: number, value: string) {
    const answers = this.questions()[idx].answers.map((a, i) => (i === answerIdx ? value : a));
    this.patch(idx, { answers });
  }

  setCorrect(idx: number, correct: number) {
    this.patch(idx, { correct });
  }

  setTime(idx: number, timeLimitSec: number) {
    this.patch(idx, { timeLimitSec });
  }

  // --- A question's picture ---

  imageUrl = (name: string) => this.quiz.imageUrl(name);

  // One of my own: shrunk here first, so it's quick to send.
  async pickFile(idx: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploadingFor() !== null) return;
    this.uploadingFor.set(idx);
    try {
      const blob = await shrinkImage(file);
      this.quiz.uploadImage(blob).subscribe(this.pictureFor(idx));
    } catch {
      this.uploadingFor.set(null);
      this.notifications.addError('Ezt a képet nem sikerült beolvasni.');
    }
  }

  // A photo of a tour's album: the server makes the quiz a copy of it.
  fromTour(photo: PickedTourPhoto) {
    const idx = this.pickingFor();
    this.pickingFor.set(null);
    if (idx === null || this.uploadingFor() !== null) return;
    this.uploadingFor.set(idx);
    this.quiz.imageFromTour(photo.tourId, photo.filename).subscribe(this.pictureFor(idx));
  }

  private pictureFor(idx: number) {
    return {
      next: (image: string) => {
        this.uploadingFor.set(null);
        this.patch(idx, { image });
      },
      error: (err: unknown) => {
        this.uploadingFor.set(null);
        this.notifications.addError(errorMessage(err, 'Nem sikerült a képet elmenteni.'));
      },
    };
  }

  removeImage(idx: number) {
    this.patch(idx, { image: null });
  }

  addQuestion() {
    if (this.isFull()) return;
    this.questions.update((list) => [...list, blankQuestion()]);
    // Once it's on the page: into view, ready to type.
    setTimeout(() => {
      const cards = this.host.nativeElement.querySelectorAll<HTMLElement>('.question textarea');
      cards[cards.length - 1]?.focus();
    });
  }

  async removeQuestion(idx: number) {
    const q = this.questions()[idx];
    if (q.text.trim() || filled(q.answers)) {
      const ok = await this.confirm.ask({ message: `Törlöd a(z) ${idx + 1}. kérdést?` });
      if (!ok) return;
    }
    this.questions.update((list) => list.filter((_, i) => i !== idx));
  }

  // One place up (-1) or down (+1).
  move(idx: number, by: number) {
    const to = idx + by;
    if (to < 0 || to >= this.questions().length) return;
    this.questions.update((list) => {
      const next = [...list];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }

  // What's sent: the empty answer slots left out (the right answer's place
  // counted among the ones that stay).
  private toDraft(): QuizDraft {
    return {
      title: this.title().trim(),
      questions: this.questions().map((q) => {
        const kept = q.answers.map((a, i) => ({ a: a.trim(), i })).filter((x) => x.a);
        return {
          text: q.text.trim(),
          image: q.image ?? null,
          answers: kept.map((x) => x.a),
          correct: kept.findIndex((x) => x.i === q.correct),
          timeLimitSec: q.timeLimitSec,
        };
      }),
    };
  }

  save() {
    if (this.problem() || this.saving() || this.uploadingFor() !== null) return;
    this.saving.set(true);
    const draft = this.toDraft();
    const request = this.id ? this.quiz.updateQuiz(this.id, draft) : this.quiz.createQuiz(draft);
    request.subscribe({
      next: () => {
        this.notifications.addSuccess('A kvíz elmentve.');
        this.router.navigate(['/moka/kviz/szerkeszto']);
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült menteni a kvízt.'));
      },
    });
  }
}
