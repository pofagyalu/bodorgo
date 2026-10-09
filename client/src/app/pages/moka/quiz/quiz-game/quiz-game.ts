import { Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../../components/avatar/avatar';
import { AuthService } from '../../../../auth/auth.service';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../../shared/errors';
import { Podium, PodiumWinner } from '../../../../shared/podium/podium';
import { MusicPlayerService } from '../../../../services/music-player';
import { QuizGame, QuizPlace, QuizPlayer, QuizService } from '../../../../services/quiz';
import { TourSocketService } from '../../../../services/tour-socket';
import { MapGuess } from '../quiz-map/quiz-map';
import { QuizQuestionView } from '../quiz-question/quiz-question';
import { QuizStandings } from '../quiz-standings/quiz-standings';
import { blockPageZoom } from '../../../../shared/page-zoom';

const TICK_MS = 200;
// A question still open this long after its time: the closing was missed
// (the connection dropped, say) - the game is asked for again.
const OVERDUE_MS = 1500;
const REFETCH_GAP_MS = 3000;
// How many are shown of the standings between two questions.
const TOP = 5;
// Móka → Kvíz: a game, live - the same page for the host (who leads: the
// code to join with, then one button from question to question) and for
// the players (who answer on their own phones). The question (shown by
// quiz-question), the countdown and the answers are on every screen; a
// song question's song plays on the host's device only. Everything is decided by
// the server, its clock included; after each change it sends the game as
// it now stands ('quiz-game'), and this only shows it.
@Component({
  selector: 'app-quiz-game',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    MatIconModule,
    Avatar,
    Podium,
    QuizQuestionView,
    QuizStandings,
  ],
  templateUrl: './quiz-game.html',
  styleUrl: './quiz-game.scss',
})
export class QuizGamePage implements OnDestroy {
  private quiz = inject(QuizService);
  private socket = inject(TourSocketService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private music = inject(MusicPlayerService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;
  readonly myId = inject(AuthService).user()?.id;
  // Where to type the code in, for whoever can't scan it.
  readonly joinAddress = `${window.location.host}/moka/kviz`;

  game = signal<QuizGame | null>(null);
  // No such game (or it couldn't be loaded).
  missing = signal(false);
  // What I tapped on the open question - on a map question, where my pin is.
  myAnswer = signal<number | null>(null);
  myGuess = signal<QuizPlace | null>(null);
  // The host's: the song couldn't start by itself (the browser wants a tap).
  songBlocked = signal(false);
  private song: HTMLAudioElement | null = null;
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
  live = computed(() =>
    ['lobby', 'question', 'reveal', 'standings'].includes(this.game()?.status ?? ''),
  );
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

  // Between two questions: the best few - and me, if I'm not among them.
  top = computed<QuizPlayer[]>(() => {
    const players = this.game()?.players ?? [];
    const me = this.me();
    const best = players.slice(0, TOP);
    return me && !best.includes(me) ? [...best, me] : best;
  });

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

  // What the tiles' order is made from - the same on every phone.
  seed = computed(() => `${this.game()?._id}:${this.game()?.questionIdx}`);

  // A map question: my pin - once it's closed, where the server has it -
  // and then everyone's.
  myPin = computed(() =>
    this.game()?.status === 'reveal' ? (this.me()?.guess ?? null) : this.myGuess(),
  );
  mapGuesses = computed<MapGuess[]>(() =>
    (this.game()?.players ?? []).flatMap((p) =>
      p.guess ? [{ ...p.guess, name: p.name, me: p.userId === this.myId }] : [],
    ),
  );

  // The song question whose song should be heard here: the host's device
  // only, from the question's opening until the next one.
  private songOn = computed(() => {
    const g = this.game();
    const on =
      this.isHost() && g?.question?.type === 'song' && ['question', 'reveal'].includes(g.status);
    return on ? g!.questionIdx : null;
  });

  // Gives the page its zoom back (see the constructor).
  private allowPageZoom: () => void;

  constructor() {
    effect(() => this.playSong(this.songOn()));
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
    // No zooming the page while a game is open (shared/page-zoom): a
    // zoomed-in picture would give the answer away, and a stray pinch loses
    // the buttons in the middle of a question. (A Térkép question's map
    // still zooms in itself - quiz-map.)
    this.allowPageZoom = blockPageZoom();
  }

  ngOnDestroy() {
    this.allowPageZoom();
    clearInterval(this.ticker);
    this.stopListening.forEach((stop) => stop());
    this.socket.leaveQuiz(this.id);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.playSong(null);
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
    if (game.myAnswer !== undefined) {
      this.myAnswer.set(game.myAnswer);
      this.myGuess.set(game.myGuess ?? null);
    } else if (before?.questionIdx !== game.questionIdx) {
      this.myAnswer.set(null);
      this.myGuess.set(null);
    }
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

  // One answer each - but a map question's pin may be moved while it's open.
  canAnswer = computed(() => {
    const g = this.game();
    if (g?.status !== 'question' || !this.me()) return false;
    return g.question?.type === 'map' || this.myAnswer() === null;
  });

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

  // A map question: my pin down, or moved.
  putPin(place: QuizPlace) {
    if (!this.canAnswer()) return;
    // Shown at once - the server's word comes after.
    this.myGuess.set(place);
    this.quiz.putPin(this.id, place).subscribe({
      next: (game) => this.show(game),
      error: (err) => {
        this.notifications.addError(errorMessage(err, 'Nem sikerült elküldeni a jelölőt.'));
        this.load();
      },
    });
  }

  // What my last answer came to, once the question is closed - on a map
  // question: how far off my pin was (`far`), or that I had none.
  myResult = computed<'right' | 'wrong' | 'none' | 'far' | null>(() => {
    const g = this.game();
    const me = this.me();
    if (g?.status !== 'reveal' || !me) return null;
    if (g.question?.type === 'map') return me.guess ? 'far' : 'none';
    if (me.answer == null) return 'none';
    return me.points ? 'right' : 'wrong';
  });

  // --- The host's ---

  // A song question's song, on this device: started when its question
  // opens (whatever else was playing here stops), stopped with the next
  // question. `questionIdx` null: no song now.
  private playSong(questionIdx: number | null) {
    this.song?.pause();
    this.song = null;
    this.songBlocked.set(false);
    if (questionIdx === null) return;
    if (this.music.isPlaying()) this.music.stop();
    this.song = new Audio(this.quiz.songUrl(this.id, questionIdx));
    this.startSong();
  }

  // Also the "Zene indítása" button: a browser may want a tap first.
  startSong() {
    if (!this.song) return;
    this.songBlocked.set(false);
    try {
      void this.song.play()?.catch(() => this.songBlocked.set(true));
    } catch {
      this.songBlocked.set(true);
    }
  }

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
}
