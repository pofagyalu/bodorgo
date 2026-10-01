import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable, firstValueFrom } from 'rxjs';
import { Avatar } from '../../../../components/avatar/avatar';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { playCelebration } from '../../../../shared/celebration-effects';
import { errorMessage } from '../../../../shared/errors';
import { Podium, PodiumWinner } from '../../../../shared/podium/podium';
import {
  CRICKET_TARGETS,
  DartThrow,
  DartsGame,
  DartsService,
  dartLabel,
  gameName,
} from '../../../../services/darts';

// What flashes up for a moment: a bust, a finish, whose turn.
interface Announcement {
  kind: 'next' | 'bust' | 'finish';
  title: string;
  sub?: string;
}

// A turn being corrected: it starts with the turn's own darts, and the
// keypad replaces the selected one instead of throwing.
interface Editing {
  turnIdx: number;
  throws: DartThrow[];
  selected: number;
}

const ANNOUNCE_MS = 1600;
// One of the logo's colors per player, by their place in the order.
const PLAYER_COLORS = [
  '--logo-orange',
  '--logo-blue',
  '--logo-green',
  '--logo-red',
  '--logo-yellow',
  '--logo-dark-green',
  '--logo-brown',
];
const MEDALS = ['🥇', '🥈', '🥉'];
// Cricket's marks: one hit, two, closed.
const MARKS = ['', '╱', '✕', '⊗'];

// Móka → Darts: a game on one phone. The scoreboard on top, the current
// turn's three darts under it, the keypad at the bottom within thumb
// reach. Every dart goes to the server, which answers the
// whole game as it now stands (the rules live there) - this only shows it,
// and celebrates.
@Component({
  selector: 'app-darts-game',
  imports: [RouterLink, MatIconModule, Avatar, Podium],
  templateUrl: './darts-game.html',
  styleUrl: './darts-game.scss',
})
export class DartsGamePage implements OnDestroy {
  private darts = inject(DartsService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;

  readonly multipliers = [
    { value: 1, label: 'Szimpla' },
    { value: 2, label: 'Dupla' },
    { value: 3, label: 'Tripla' },
  ];
  readonly targets = CRICKET_TARGETS;

  game = signal<DartsGame | null>(null);
  loadFailed = signal(false);
  multiplier = signal(1);
  announcement = signal<Announcement | null>(null);
  editing = signal<Editing | null>(null);
  historyOpen = signal(false);
  private announceTimer?: ReturnType<typeof setTimeout>;
  private podium = viewChild(Podium);

  // The requests go one after the other, in the order the keys were
  // tapped - a quick second dart waits for the first one's answer.
  private queue: Promise<void> = Promise.resolve();

  isCricket = computed(() => this.game()?.type === 'cricket');
  name = computed(() => (this.game() ? gameName(this.game()!) : ''));
  playing = computed(() => this.game()?.status === 'in_progress');
  current = computed(() => {
    const g = this.game();
    return g?.next ? g.players[g.next.playerIdx] : null;
  });
  // The X01 scoreboard's cards in a row: on a phone, on a desktop.
  cols = computed(() => Math.min(this.game()?.players.length ?? 1, 4));
  colsWide = computed(() => Math.min(this.game()?.players.length ?? 1, 8));
  // The keypad's numbers: all twenty - in Cricket only the ones that count.
  numbers = computed(() =>
    this.isCricket() ? [20, 19, 18, 17, 16, 15] : Array.from({ length: 20 }, (_, i) => i + 1),
  );

  // The darts shown in the three slots: the turn being corrected, or the
  // open turn so far.
  shownThrows = computed(() => {
    const edit = this.editing();
    if (edit) return edit.throws;
    return this.openTurn()?.throws ?? [];
  });
  private openTurn = computed(() => {
    const g = this.game();
    if (!g?.next || g.next.dartsLeft === 3) return null;
    return g.turns?.at(-1) ?? null;
  });
  slots = computed(() => {
    const labels = this.shownThrows().map(dartLabel);
    return [0, 1, 2].map((i) => labels[i] ?? null);
  });
  // Beside the slots: the turn's points - in Cricket its hits (and points).
  turnTotal = computed(() => {
    if (!this.isCricket()) {
      return String(this.shownThrows().reduce((sum, t) => sum + t.segment * t.multiplier, 0));
    }
    const turn = this.editing() ? null : this.openTurn();
    if (!turn) return '';
    return `${turn.marks ?? 0}✕${turn.points ? ` +${turn.points}` : ''}`;
  });
  checkout = computed(() =>
    this.editing() ? null : (this.game()?.next?.checkout?.map(dartLabel).join(' · ') ?? null),
  );
  editedTurn = computed(() => {
    const edit = this.editing();
    const turn = edit && this.game()?.turns?.[edit.turnIdx];
    return turn ? { ...turn, name: this.game()!.players[turn.playerIdx].name } : null;
  });

  // The turns, the latest first, each with its place in the game's list.
  history = computed(() => {
    const g = this.game();
    return (g?.turns ?? [])
      .map((turn, turnIdx) => ({
        ...turn,
        turnIdx,
        name: g!.players[turn.playerIdx].name,
        darts: turn.throws.map(dartLabel).join(' · '),
        worth:
          g!.type === 'cricket'
            ? `${turn.marks ?? 0}✕${turn.points ? ` +${turn.points}` : ''}`
            : String(turn.points),
      }))
      .reverse();
  });

  // Whoever has a place, on the podium: its first three.
  winners = computed<PodiumWinner[]>(() =>
    (this.game()?.players ?? [])
      .filter((p) => p.position !== null && p.position <= 3)
      .map((p) => ({
        place: p.position as 1 | 2 | 3,
        userId: p.userId ?? '',
        name: p.name,
        photoVersion: p.photoUpdatedAt,
      })),
  );
  ranking = computed(() => {
    const g = this.game();
    return g ? g.placings.map((idx) => g.players[idx]) : [];
  });

  // The player whose turn it is stays in view, however many play.
  private followCurrent = effect(() => {
    const idx = this.game()?.next?.playerIdx;
    if (idx === undefined) return;
    setTimeout(() =>
      this.host.nativeElement
        .querySelector('.scores .current')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  });

  constructor() {
    this.darts.getGame(this.id).subscribe({
      next: (game) => this.game.set(game),
      error: () => this.loadFailed.set(true),
    });
    void this.keepAwake();
  }

  color(idx: number): string {
    return `var(${PLAYER_COLORS[idx % PLAYER_COLORS.length]})`;
  }

  medal(position: number): string {
    return MEDALS[position - 1] ?? `${position}.`;
  }

  // Cricket: how a number stands for a player - "╱", "✕", "⊗" (closed).
  mark(hits: number | undefined): string {
    return MARKS[Math.min(hits ?? 0, 3)];
  }

  // Cricket: nobody still playing can score on it any more.
  closedByAll(target: number): boolean {
    const g = this.game();
    return !!g && g.players.every((p) => (p.marks?.[target] ?? 0) >= 3);
  }

  // A key of the keypad: 1-20, 25 (the bull) or 0 (a miss).
  hit(segment: number) {
    const dart: DartThrow =
      segment === 0 ? { segment: 0, multiplier: 0 } : { segment, multiplier: this.multiplier() };
    this.multiplier.set(1);
    this.enter(dart);
  }

  private enter(dart: DartThrow) {
    const edit = this.editing();
    if (edit) {
      // Replaces the selected dart (the others stay as they were) - or
      // fills the first empty slot, if that's the one selected.
      const throws = [...edit.throws];
      throws[edit.selected] = dart;
      this.editing.set({ ...edit, throws });
      return;
    }
    this.run(() => this.darts.throwDart(this.id, dart), true);
  }

  undo() {
    const edit = this.editing();
    if (edit) {
      // While correcting: the turn's last dart is taken off.
      const throws = edit.throws.slice(0, -1);
      this.editing.set({ ...edit, throws, selected: Math.min(edit.selected, throws.length) });
      return;
    }
    this.run(() => this.darts.undo(this.id));
  }

  // --- Correcting an earlier turn ---

  // The turn's darts appear in the slots as they were; tapping a slot
  // selects the dart the keypad then replaces.
  startEdit(turnIdx: number) {
    const turn = this.game()?.turns?.[turnIdx];
    if (!turn || !this.game()?.canEdit) return;
    this.multiplier.set(1);
    this.editing.set({ turnIdx, throws: [...turn.throws], selected: 0 });
    this.historyOpen.set(false);
    setTimeout(() =>
      this.host.nativeElement
        .querySelector('.turn')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  }

  // A filled slot, or the first empty one after them.
  selectSlot(i: number) {
    const edit = this.editing();
    if (edit && i <= edit.throws.length) this.editing.set({ ...edit, selected: i });
  }

  cancelEdit() {
    this.editing.set(null);
  }

  // Asks first if the correction would change anyone's place (the server
  // works out how the game would stand, without storing it).
  async saveEdit() {
    const edit = this.editing();
    const before = this.game();
    if (!edit?.throws.length || !before) return;
    try {
      const after = await firstValueFrom(
        this.darts.editTurn(this.id, edit.turnIdx, edit.throws, true),
      );
      const place = (n: number | null) => (n ? `${n}. hely` : 'nincs helyezés');
      const moves = before.players
        .filter((p) => p.position !== after.players[p.idx].position)
        .map((p) => `${p.name}: ${place(p.position)} → ${place(after.players[p.idx].position)}`);
      if (moves.length) {
        const ok = await this.confirm.ask({
          title: 'Ez a javítás a helyezéseket is átírja',
          message: moves.join(' · '),
          confirmText: 'Mehet',
          danger: false,
        });
        if (!ok) return;
      }
    } catch (err) {
      this.notifications.addError(errorMessage(err, 'Ezt a javítást nem lehet elmenteni.'));
      return;
    }
    this.editing.set(null);
    this.run(() => this.darts.editTurn(this.id, edit.turnIdx, edit.throws));
  }

  // "Befejezés": the players agree it's over - it ends as it stands. A
  // game given up before its first round is through (started by mistake,
  // most likely) counts for nothing instead.
  async finish() {
    const g = this.game();
    if (!g) return;
    if ((g.turns?.length ?? 0) < g.players.length) {
      const ok = await this.confirm.ask({
        title: 'Abbahagyjátok?',
        message: 'Még az első kör sem ment le, így ez a játék nem számít bele a ranglistába.',
        confirmText: 'Abbahagyjuk',
      });
      if (ok) this.run(() => this.darts.abandon(this.id));
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Befejezitek a játékot?',
      message:
        'A játék a mostani állással ér véget: aki már kiszállt, megtartja a helyét, a többiek a jelenlegi állás szerint következnek.',
      detail: 'Ha mégis folytatnátok, az eredménynél vissza lehet vonni.',
      confirmText: 'Befejezzük',
      danger: false,
    });
    if (!ok) return;
    this.run(() => this.darts.finish(this.id), false, true);
  }

  // The same players and rules again.
  rematch() {
    const g = this.game();
    if (!g) return;
    this.darts
      .createGame({
        type: g.type,
        startScore: g.options.startScore,
        outMode: g.options.outMode,
        players: g.players.map((p) => (p.userId ? { userId: p.userId } : { guestName: p.name })),
      })
      .subscribe({
        // A new address for the same page: load it afresh.
        next: (game) =>
          this.router
            .navigateByUrl('/moka/darts', { skipLocationChange: true })
            .then(() => this.router.navigate(['/moka/darts', game._id])),
        error: (err) =>
          this.notifications.addError(errorMessage(err, 'Nem sikerült elindítani a visszavágót.')),
      });
  }

  private run(request: () => Observable<DartsGame>, thrown = false, ended = false) {
    this.queue = this.queue.then(async () => {
      const before = this.game();
      try {
        const game = await firstValueFrom(request());
        this.game.set(game);
        if (before && thrown) this.react(before, game);
        // Once the podium is on the page.
        if (ended) setTimeout(() => this.podium()?.celebrate(1));
      } catch (err) {
        this.notifications.addError(errorMessage(err, 'Nem sikerült – próbáld újra.'));
      }
    });
  }

  // What a dart just did: a bust, a finish, the game's end, the next player.
  private react(before: DartsGame, game: DartsGame) {
    const turn = game.turns?.at(-1);
    const nextName = game.next ? game.players[game.next.playerIdx].name : undefined;
    const changed = game.next?.playerIdx !== before.next?.playerIdx;
    const sub = changed && nextName ? `Következik: ${nextName}` : undefined;

    if (game.status === 'finished') {
      this.announcement.set(null);
      // Once the podium is on the page.
      setTimeout(() => this.podium()?.celebrate(1));
    } else if (turn?.finished) {
      const who = game.players[turn.playerIdx];
      const did = game.type === 'cricket' ? 'mindent lezárt' : 'kiszállt';
      this.announce({ kind: 'finish', title: `${who.name} ${did}! 🎯`, sub });
      void playCelebration('confetti', 2500);
    } else if (turn?.bust) {
      this.announce({ kind: 'bust', title: 'Besokallt! 💥', sub });
    } else if (changed && nextName) {
      this.announce({ kind: 'next', title: nextName, sub: 'következik' });
    }
  }

  private announce(a: Announcement) {
    this.announcement.set(a);
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => this.announcement.set(null), ANNOUNCE_MS);
  }

  // --- The screen stays on during a game ---

  private wakeLock: WakeLockSentinel | null = null;

  // The browser lets the lock go whenever the page is hidden - asked for
  // again each time it comes back.
  @HostListener('document:visibilitychange')
  async keepAwake() {
    if (document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Not supported, or refused (e.g. battery saver) - the game works anyway.
    }
  }

  ngOnDestroy() {
    clearTimeout(this.announceTimer);
    void this.wakeLock?.release();
  }
}
