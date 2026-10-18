import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../components/avatar/avatar';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { errorMessage } from '../../../shared/errors';
import { ANSWER_SHAPES, QuizGameSummary, QuizResult, QuizService } from '../../../services/quiz';
import { QuizShape } from './quiz-shape/quiz-shape';

const MEDALS = ['🥇', '🥈', '🥉'];
const PIN_LENGTH = 6;

// Móka → Kvíz → Játékszoba: the opening page - a code to join a game with,
// the games on right now, the leaderboard (the best results of all time:
// who scored how much in which game) and every game played so far, the newest first, with its winners.
@Component({
  selector: 'app-quiz-home',
  imports: [RouterLink, DatePipe, DecimalPipe, MatIconModule, Avatar, QuizShape],
  templateUrl: './quiz-home.html',
  styleUrl: './quiz-home.scss',
})
export class QuizHome {
  private quiz = inject(QuizService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);
  readonly myId = inject(AuthService).user()?.id;
  readonly shapes = ANSWER_SHAPES;
  readonly medals = MEDALS;

  // null: still loading.
  games = signal<QuizGameSummary[] | null>(null);
  leaders = signal<QuizResult[] | null>(null);
  pin = signal('');
  joining = signal(false);

  // On right now - to join, or (my own) to lead on.
  live = computed(() => (this.games() ?? []).filter((g) => g.status !== 'finished'));
  played = computed(() => (this.games() ?? []).filter((g) => g.status === 'finished'));
  pinReady = computed(() => this.pin().length === PIN_LENGTH);

  constructor() {
    this.quiz
      .getGames()
      .subscribe({ next: (games) => this.games.set(games), error: () => this.games.set([]) });
    this.quiz.getLeaderboard().subscribe({
      next: (leaders) => this.leaders.set(leaders),
      error: () => this.leaders.set([]),
    });
  }

  // Digits only, however they were typed or pasted.
  typePin(value: string) {
    this.pin.set(value.replace(/\D/g, '').slice(0, PIN_LENGTH));
  }

  joinByPin() {
    if (!this.pinReady() || this.joining()) return;
    this.joining.set(true);
    this.quiz.findByPin(this.pin()).subscribe({
      next: (gameId) => this.router.navigate(['/moka/kviz/jatekok', gameId]),
      error: (err) => {
        this.joining.set(false);
        this.notifications.addError(errorMessage(err, 'Ilyen kóddal most nincs játék.'));
      },
    });
  }
}
