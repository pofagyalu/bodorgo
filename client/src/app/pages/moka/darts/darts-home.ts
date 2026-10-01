import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../components/avatar/avatar';
import { AuthService } from '../../../auth/auth.service';
import { DartsGame, DartsLeader, DartsService, DartsType, gameName } from '../../../services/darts';
import { DartBoard } from './dart-board/dart-board';

const MEDALS = ['🥇', '🥈', '🥉'];

// Which leaderboard: a kind of game - X01's can be just one start score.
interface Board {
  label: string;
  type: DartsType;
  startScore?: number;
}

// Móka → Darts: the opening page - the board, a new game, the leaderboards
// (everyone's numbers, one per kind of game) and my own games (nobody sees
// anyone else's), the ones still on there to carry on with.
@Component({
  selector: 'app-darts-home',
  imports: [RouterLink, DatePipe, MatIconModule, Avatar, DartBoard],
  templateUrl: './darts-home.html',
  styleUrl: './darts-home.scss',
})
export class DartsHome {
  private darts = inject(DartsService);
  readonly myId = inject(AuthService).user()?.id;
  readonly gameName = gameName;

  readonly boards: Board[] = [
    { label: '301', type: 'x01', startScore: 301 },
    { label: '201', type: 'x01', startScore: 201 },
    { label: '101', type: 'x01', startScore: 101 },
    { label: 'Cricket', type: 'cricket' },
  ];
  board = signal(this.boards[0]);

  games = signal<DartsGame[] | null>(null);
  // null: still loading.
  leaders = signal<DartsLeader[] | null>(null);

  constructor() {
    this.darts
      .getGames()
      .subscribe({ next: (games) => this.games.set(games), error: () => this.games.set([]) });
    this.showBoard(this.board());
  }

  showBoard(board: Board) {
    this.board.set(board);
    this.darts.getLeaderboard(board.type, board.startScore).subscribe({
      // A slower answer for a board since left is dropped.
      next: (leaders) => {
        if (this.board() === board) this.leaders.set(leaders);
      },
      error: () => this.leaders.set([]),
    });
  }

  // The players as the game stands: by place once there is one, then in
  // throwing order - "🥇 Peti · 🥈 Gabi · Zoli (87)" (what's left in X01,
  // the points in Cricket).
  standing(game: DartsGame): string {
    const placed = game.placings.map((idx) => game.players[idx]);
    const rest = game.players.filter((p) => !game.placings.includes(p.idx));
    return [
      ...placed.map((p, i) => `${MEDALS[i] ?? `${i + 1}.`} ${p.name}`),
      ...rest.map((p) => `${p.name} (${game.type === 'cricket' ? p.points : p.remaining})`),
    ].join(' · ');
  }
}
