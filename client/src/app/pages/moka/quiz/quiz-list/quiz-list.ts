import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../../shared/errors';
import { Quiz, QuizService } from '../../../../services/quiz';

// Móka → Kvíz → Kvízek: every quiz there is. Anyone may write one; its
// author alone may change, delete or start it (the others would see the
// answers in the editor) - everyone else only sees that it exists, and
// joins when it's played.
@Component({
  selector: 'app-quiz-list',
  imports: [RouterLink, DatePipe, MatIconModule],
  templateUrl: './quiz-list.html',
  styleUrl: './quiz-list.scss',
})
export class QuizList {
  private quiz = inject(QuizService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);

  // null: still loading.
  quizzes = signal<Quiz[] | null>(null);
  // The quiz whose game is just being started.
  starting = signal<string | null>(null);

  constructor() {
    this.quiz.getQuizzes().subscribe({
      next: (quizzes) => this.quizzes.set(quizzes),
      error: (err) => {
        this.quizzes.set([]);
        this.notifications.addError(errorMessage(err, 'Nem sikerült betölteni a kvízeket.'));
      },
    });
  }

  // A game of it: straight to its lobby, where the players join.
  start(quiz: Quiz) {
    if (this.starting()) return;
    this.starting.set(quiz._id);
    this.quiz.startGame(quiz._id).subscribe({
      next: (game) => this.router.navigate(['/moka/kviz/jatekok', game._id]),
      error: (err) => {
        this.starting.set(null);
        this.notifications.addError(errorMessage(err, 'Nem sikerült elindítani a játékot.'));
      },
    });
  }

  async remove(quiz: Quiz) {
    const ok = await this.confirm.ask({
      title: 'Törlöd a kvízt?',
      message: `„${quiz.title}” – a kérdései elvesznek.`,
      detail: 'A már lejátszott játékok megmaradnak.',
    });
    if (!ok) return;
    this.quiz.deleteQuiz(quiz._id).subscribe({
      next: () => this.quizzes.update((list) => (list ?? []).filter((q) => q._id !== quiz._id)),
      error: (err) =>
        this.notifications.addError(errorMessage(err, 'Nem sikerült törölni a kvízt.')),
    });
  }
}
