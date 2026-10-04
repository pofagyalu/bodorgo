import { Component, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../../components/avatar/avatar';
import { AuthService } from '../../../../auth/auth.service';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../../shared/errors';
import { Podium, PodiumWinner } from '../../../../shared/podium/podium';
import { ANSWER_SHAPES, QuizGame, QuizPlayer, QuizService } from '../../../../services/quiz';
import { TourSocketService } from '../../../../services/tour-socket';

const TICK_MS = 200;
// A question still open this long after its time: the closing was missed
// (the connection dropped, say) - the game is asked for again.
const OVERDUE_MS = 1500;
const REFETCH_GAP_MS = 3000;
// How many are shown of the standings between two questions.
const TOP = 5;
// A picture question's picture is under this many tiles (8 x 6, see
// quiz-game.scss), which go one by one - the last one this far into the
// question's time, so the whole picture is there for the end.
const TILES = 48;
const UNCOVERED_BY = 0.85;

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

// Móka → Kvíz: a game, live - the same page for the host (who leads: the
// code to join with, then one button from question to question) and for
// the players (who answer on their own phones). The question, the
// countdown and the answers are on every screen. Everything is decided by
// the server, its clock included; after each change it sends the game as
// it now stands ('quiz-game'), and this only shows it.
@Component({
  selector: 'app-quiz-game',
  imports: [NgTemplateOutlet, RouterLink, MatIconModule, Avatar, Podium],
  templateUrl: './quiz-game.html',
  styleUrl: './quiz-game.scss',
})
export class QuizGamePage implements OnDestroy {
  private quiz = inject(QuizService);
  private socket = inject(TourSocketService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;
  readonly myId = inject(AuthService).user()?.id;
  readonly shapes = ANSWER_SHAPES;
  // Where to type the code in, for whoever can't scan it.
  readonly joinAddress = `${window.location.host}/moka/kviz`;

  game = signal<QuizGame | null>(null);
  // No such game (or it couldn't be loaded).
  missing = signal(false);
  // What I tapped on the open question.
  myAnswer = signal<number | null>(null);
  // The host's: the game's link to scan.
  qr = signal<string | null>(null);
  busy = signal(false);

  // This phone's clock, ticking while the game is on - and how far the
  // server's is from it (the countdown runs by the server's).
  private now = signal(Date.now());
  private offset = 0;
  private ticker = setInterval(() => this.tick(), TICK_MS);
  private lastFetch = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private podium = viewChild(Podium);
  private stopListening: (() => void)[] = [];

  isHost = computed(() => this.game()?.host._id === this.myId);
  me = computed(() => this.game()?.players.find((p) => p.userId === this.myId) ?? null);
  live = computed(() => ['lobby', 'question', 'reveal'].includes(this.game()?.status ?? ''));
  isLast = computed(() => {
    const g = this.game();
    return !!g && g.questionIdx === g.questionCount - 1;
  });
  answeredCount = computed(() => this.game()?.players.filter((p) => p.answered).length ?? 0);

  private msLeft = computed(() => {
    const g = this.game();
    if (g?.status !== 'question' || !g.question) return 0;
    return Math.max(0, Date.parse(g.question.endsAt) - (this.now() + this.offset));
  });
  secondsLeft = computed(() => Math.ceil(this.msLeft() / 1000));
  // How much of the time is left, 1 → 0 (the bar under the question).
  timeLeft = computed(() => {
    const limit = (this.game()?.question?.timeLimitSec ?? 0) * 1000;
    return limit ? Math.min(1, this.msLeft() / limit) : 0;
  });

  // --- A picture question ---

  imageUrl = (name: string) => this.quiz.imageUrl(name);

  // Each tile's turn to go (0: the first) - its own order for each question.
  tileTurns = computed(() => {
    const g = this.game();
    return g?.question?.image ? shuffled(TILES, `${g._id}:${g.questionIdx}`) : [];
  });

  // How many tiles are off by now: more and more while the clock runs, all
  // of them once the question is closed.
  tilesGone = computed(() => {
    if (this.game()?.status !== 'question') return TILES;
    return Math.floor(Math.min(1, (1 - this.timeLeft()) / UNCOVERED_BY) * TILES);
  });

  // Between two questions: the best few - and me, if I'm not among them.
  top = computed<QuizPlayer[]>(() => {
    const players = this.game()?.players ?? [];
    const me = this.me();
    const best = players.slice(0, TOP);
    return me && !best.includes(me) ? [...best, me] : best;
  });

  // The most taps an answer got - the bars are measured against it.
  private mostTaps = computed(() => Math.max(1, ...(this.game()?.question?.counts ?? [])));

  winners = computed<PodiumWinner[]>(() =>
    (this.game()?.players ?? [])
      .filter((p) => p.rank <= 3)
      .map((p) => ({
        place: p.rank as 1 | 2 | 3,
        userId: p.userId,
        name: p.name,
        photoVersion: p.photoUpdatedAt,
      })),
  );

  constructor() {
    this.load(true);
    this.socket.joinQuiz(this.id);
    this.stopListening = [
      this.socket.on<QuizGame>('quiz-game', (game) => {
        if (game._id === this.id) this.show(game);
      }),
      // Back after a dropped connection: whatever was missed.
      this.socket.on('connect', () => this.load()),
    ];
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy() {
    clearInterval(this.ticker);
    this.stopListening.forEach((stop) => stop());
    this.socket.leaveQuiz(this.id);
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.wakeLock?.release().catch(() => {});
  }

  // The phone woke up, or the tab came back: the game may have moved on.
  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    this.load();
    if (this.live()) void this.keepAwake();
  };

  // `first`: the page has just opened - whoever isn't the host steps into
  // a game still on, and the host of one in the lobby gets its QR code.
  private load(first = false) {
    this.lastFetch = Date.now();
    this.quiz.getGame(this.id).subscribe({
      next: (game) => {
        this.show(game);
        if (!first) return;
        if (this.live()) void this.keepAwake();
        if (this.isHost() && game.status === 'lobby') {
          this.quiz.getQr(this.id).subscribe({ next: (qr) => this.qr.set(qr), error: () => {} });
        } else if (this.live() && !this.isHost() && !this.me()) {
          this.quiz.join(this.id).subscribe({
            next: (joined) => this.show(joined),
            error: (err) =>
              this.notifications.addError(errorMessage(err, 'Nem sikerült csatlakozni.')),
          });
        }
      },
      error: () => {
        if (first) this.missing.set(true);
      },
    });
  }

  // The game as the server now has it - from an answer to me (with my own
  // answer in it) or sent to everyone. An older one than what's on screen
  // (the two can overtake each other) is dropped.
  private show(game: QuizGame) {
    const before = this.game();
    if (before && Date.parse(game.serverNow) < Date.parse(before.serverNow)) return;

    this.now.set(Date.now());
    this.offset = Date.parse(game.serverNow) - this.now();
    // What's sent to everyone has nobody's answer in it: mine stays while
    // the question does.
    if (game.myAnswer !== undefined) this.myAnswer.set(game.myAnswer);
    else if (before?.questionIdx !== game.questionIdx) this.myAnswer.set(null);
    this.game.set(game);

    if (before && before.status !== 'finished' && game.status === 'finished') {
      // Once the podium is on the page.
      setTimeout(() => this.podium()?.celebrate(1));
    }
    if (!this.live()) void this.wakeLock?.release().catch(() => {});
  }

  private tick() {
    const g = this.game();
    if (g?.status !== 'question' || !g.question) return;
    const now = Date.now();
    this.now.set(now);
    const overdue = now + this.offset - Date.parse(g.question.endsAt) > OVERDUE_MS;
    if (overdue && now - this.lastFetch > REFETCH_GAP_MS) this.load();
  }

  private async keepAwake() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Not allowed (a battery saver, say): the phone's own timeout stays.
    }
  }

  // --- A player's ---

  canAnswer = computed(
    () => this.game()?.status === 'question' && !!this.me() && this.myAnswer() === null,
  );

  answer(idx: number) {
    if (!this.canAnswer()) return;
    // Shown at once - the server's word comes after.
    this.myAnswer.set(idx);
    this.quiz.answer(this.id, idx).subscribe({
      next: (game) => this.show(game),
      error: (err) => {
        this.notifications.addError(errorMessage(err, 'Nem sikerült elküldeni a választ.'));
        this.load();
      },
    });
  }

  // What my last answer came to, once the question is closed.
  myResult = computed<'right' | 'wrong' | 'none' | null>(() => {
    const me = this.me();
    if (this.game()?.status !== 'reveal' || !me) return null;
    if (me.answer == null) return 'none';
    return me.points ? 'right' : 'wrong';
  });

  // --- The host's ---

  next() {
    if (this.busy()) return;
    this.busy.set(true);
    this.quiz.next(this.id).subscribe({
      next: (game) => {
        this.busy.set(false);
        this.show(game);
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült – próbáld újra.'));
        this.load();
      },
    });
  }

  async abandon() {
    const ok = await this.confirm.ask({
      title: 'Megszakítod a játékot?',
      message: 'A játék véget ér, és nem számít bele a ranglistába.',
      confirmText: 'Megszakítom',
    });
    if (!ok) return;
    this.quiz.abandon(this.id).subscribe({
      next: (game) => this.show(game),
      error: (err) =>
        this.notifications.addError(errorMessage(err, 'Nem sikerült megszakítani a játékot.')),
    });
  }

  // How wide an answer's bar is once the question is closed, in percent.
  barWidth(idx: number): number {
    const count = this.game()?.question?.counts?.[idx] ?? 0;
    return Math.round((count / this.mostTaps()) * 100);
  }
}
