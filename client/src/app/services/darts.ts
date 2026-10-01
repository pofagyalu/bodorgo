import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

// A dart: segment 1-20 with multiplier 1-3, 25 with 1 (the bull) or 2 (the
// bullseye, 50), or 0 with 0 - a miss. The rules themselves live on the
// server (jatekok/darts: x01.js, cricket.js); the app only shows what it
// answers.
export interface DartThrow {
  segment: number;
  multiplier: number;
}

// The kinds of game: X01 (301 / 201 / 101) and Cricket.
export type DartsType = 'x01' | 'cricket';
export type DartsOutMode = 'single' | 'double';

// X01's options (they mean nothing in Cricket).
export interface DartsOptions {
  startScore: number;
  outMode: DartsOutMode;
}

// The numbers that count in Cricket, in the order they're shown (25: the bull).
export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25];

export interface DartsPlayer {
  idx: number;
  userId: string | null; // null: a guest, only named
  name: string;
  photoUpdatedAt: string | null;
  // X01: what's left.
  remaining?: number;
  // Cricket: the hits on each number, at most 3 - three close it.
  marks?: Record<number, number>;
  darts: number;
  points: number;
  // Per three darts: points in X01, marks in Cricket.
  average: number | null;
  highestTurn: number;
  // Once finished - and for everyone once the game is over.
  position: number | null;
  // False while someone still to throw in that round could take the place.
  positionFinal: boolean;
}

export interface DartsTurn {
  playerIdx: number;
  round: number;
  throws: DartThrow[];
  startScore: number;
  points: number;
  marks?: number; // Cricket: the hits that closed or scored
  bust: boolean;
  finished: boolean;
  short: boolean;
  editedAt: string | null;
  previousThrows: DartThrow[] | null;
}

export interface DartsGame {
  _id: string;
  type: DartsType;
  options: DartsOptions;
  status: 'in_progress' | 'finished' | 'abandoned';
  // The players ended it themselves ("Játék befejezése").
  ended: boolean;
  createdBy: { _id: string; name: string };
  createdAt: string;
  finishedAt: string | null;
  players: DartsPlayer[];
  placings: number[]; // player idx, best first
  canEdit: boolean;
  // Only on a single game, not in the list:
  turns?: DartsTurn[];
  next?: {
    playerIdx: number;
    round: number;
    dartsLeft: number;
    checkout: DartThrow[] | null; // X01 only
  } | null;
}

// Someone to pick as a player.
export interface DartsPerson {
  _id: string;
  name: string;
  photoUpdatedAt: string | null;
}

// One line of a leaderboard: someone's numbers over every finished game of
// one kind.
export interface DartsLeader {
  userId: string;
  name: string;
  photoUpdatedAt: string | null;
  games: number;
  firsts: number;
  seconds: number;
  thirds: number;
  average: number | null; // per three darts: points in X01, marks in Cricket
  highestTurn: number; // the best turn: points in X01, marks in Cricket
  highestCheckout: number; // X01
  count180: number; // X01
}

export interface NewDartsGame extends Partial<DartsOptions> {
  type: DartsType;
  players: ({ userId: string } | { guestName: string })[];
}

// "T20", "D16", "5", "25", "Bull" (the bullseye) - "–" for a miss.
export function dartLabel(t: DartThrow): string {
  if (t.segment === 0) return '–';
  if (t.segment === 25) return t.multiplier === 2 ? 'Bull' : '25';
  return `${['', '', 'D', 'T'][t.multiplier]}${t.segment}`;
}

// What a game is called: "301", "Cricket".
export function gameName(game: Pick<DartsGame, 'type' | 'options'>): string {
  return game.type === 'cricket' ? 'Cricket' : String(game.options.startScore);
}

interface GameResponse {
  data: { game: DartsGame };
}

@Injectable({ providedIn: 'root' })
export class DartsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/jatekok`;
  private gamesUrl = `${this.apiUrl}/darts/games`;

  private game = (res: GameResponse) => res.data.game;

  getPeople(): Observable<DartsPerson[]> {
    return this.http
      .get<{ data: { players: DartsPerson[] } }>(`${this.apiUrl}/players`)
      .pipe(map((res) => res.data.players));
  }

  // Each kind of game has its own; X01's can be narrowed to one start score.
  getLeaderboard(type: DartsType, startScore?: number): Observable<DartsLeader[]> {
    return this.http
      .get<{ data: { players: DartsLeader[] } }>(`${this.apiUrl}/darts/leaderboard`, {
        params: { type, ...(startScore && { startScore }) },
      })
      .pipe(map((res) => res.data.players));
  }

  // The games I started or play in - nobody sees anyone else's.
  getGames(): Observable<DartsGame[]> {
    return this.http
      .get<{ data: { games: DartsGame[] } }>(this.gamesUrl)
      .pipe(map((res) => res.data.games));
  }

  getGame(id: string): Observable<DartsGame> {
    return this.http.get<GameResponse>(`${this.gamesUrl}/${id}`).pipe(map(this.game));
  }

  createGame(payload: NewDartsGame): Observable<DartsGame> {
    return this.http.post<GameResponse>(this.gamesUrl, payload).pipe(map(this.game));
  }

  // Each of these answers the whole game as it now stands.
  throwDart(id: string, dart: DartThrow): Observable<DartsGame> {
    return this.http.post<GameResponse>(`${this.gamesUrl}/${id}/throws`, dart).pipe(map(this.game));
  }

  // Takes the last dart back - or, on a game the players ended, the ending.
  undo(id: string): Observable<DartsGame> {
    return this.http
      .delete<GameResponse>(`${this.gamesUrl}/${id}/throws/last`)
      .pipe(map(this.game));
  }

  // With `preview` nothing is stored: the answer is the game as it would be.
  editTurn(
    id: string,
    turnIdx: number,
    throws: DartThrow[],
    preview = false,
  ): Observable<DartsGame> {
    return this.http
      .patch<GameResponse>(
        `${this.gamesUrl}/${id}/turns/${turnIdx}`,
        { throws },
        { params: preview ? { preview: 'true' } : {} },
      )
      .pipe(map(this.game));
  }

  // "Játék befejezése": over as it stands, by the players' agreement.
  finish(id: string): Observable<DartsGame> {
    return this.http.post<GameResponse>(`${this.gamesUrl}/${id}/finish`, {}).pipe(map(this.game));
  }

  // Given up (started by mistake, say): it counts for nothing.
  abandon(id: string): Observable<DartsGame> {
    return this.http.post<GameResponse>(`${this.gamesUrl}/${id}/abandon`, {}).pipe(map(this.game));
  }
}
