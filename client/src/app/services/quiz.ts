import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

// Móka → Kvíz. The rules live on the server (jatekok/quiz/scoring.js,
// quizController.js) - its clock too: the app only shows what it answers.

// What a quiz may look like (the server checks the same).
export const MIN_ANSWERS = 2;
export const MAX_ANSWERS = 4;
export const MAX_QUESTIONS = 50;
export const TIME_LIMITS = [10, 20, 30, 60];
export const DEFAULT_TIME_LIMIT = 20;

// Each answer has its own colour and shape, wherever it's shown (the
// pages' .a0 - .a3).
export const ANSWER_SHAPES = ['▲', '◆', '●', '■'];

// The kinds of question (more to come): a plain one, or one with a picture
// that is uncovered slowly while the clock runs.
export type QuizQuestionType = 'choice' | 'picture';

// 2-4 answers, one of them right. Only a picture question has a picture
// (its name on the server - see QuizService.imageUrl).
export interface QuizQuestion {
  type: QuizQuestionType;
  text: string;
  image?: string | null;
  answers: string[];
  correct: number; // the right answer's place in `answers`
  timeLimitSec: number;
}

export interface Quiz {
  _id: string;
  title: string;
  questionCount: number;
  createdBy: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  // Only for its author, on a single quiz - they'd give the answers away.
  questions?: QuizQuestion[];
}

export interface QuizDraft {
  title: string;
  questions: QuizQuestion[];
}

// lobby → question → reveal → question → ... → reveal → finished;
// abandoned: called off by the host.
export type QuizGameStatus = 'lobby' | 'question' | 'reveal' | 'finished' | 'abandoned';

export interface QuizPlayer {
  userId: string;
  name: string;
  photoUpdatedAt: string | null;
  // Without the open question's answers - those count once it's closed.
  score: number;
  correct: number;
  rank: number;
  // The open (or just closed) question.
  answered: boolean;
  // Only once the question is closed: what they tapped, and what it was worth.
  answer?: number | null;
  points?: number;
}

export interface QuizGame {
  _id: string;
  title: string;
  pin: string | null; // while there's something to join
  status: QuizGameStatus;
  host: { _id: string; name: string };
  createdAt: string;
  finishedAt: string | null;
  questionCount: number;
  questionIdx: number; // -1 in the lobby
  players: QuizPlayer[]; // best first
  question: {
    type: QuizQuestionType;
    text: string;
    image?: string | null;
    answers: string[];
    timeLimitSec: number;
    startedAt: string;
    endsAt: string;
    // Only once it's closed.
    correct?: number;
    counts?: number[];
  } | null;
  serverNow: string;
  // My own answer to the open question - only in what the server answers
  // to me, not in what it sends to everyone.
  myAnswer?: number | null;
}

// A game in the list.
export interface QuizGameSummary {
  _id: string;
  title: string;
  status: QuizGameStatus;
  host: { _id: string; name: string };
  createdAt: string;
  finishedAt: string | null;
  questionCount: number;
  playerCount: number;
  winners: {
    place: number;
    userId: string;
    name: string;
    photoUpdatedAt: string | null;
    score: number;
  }[];
}

// One line of the leaderboard: someone's numbers over every finished game.
export interface QuizLeader {
  userId: string;
  name: string;
  photoUpdatedAt: string | null;
  games: number;
  firsts: number;
  seconds: number;
  thirds: number;
  points: number;
  correct: number;
}

interface QuizResponse {
  data: { quiz: Quiz };
}
interface GameResponse {
  data: { game: QuizGame };
}

@Injectable({ providedIn: 'root' })
export class QuizService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/jatekok/quiz`;
  private quizzesUrl = `${this.apiUrl}/quizzes`;
  private gamesUrl = `${this.apiUrl}/games`;

  private quiz = (res: QuizResponse) => res.data.quiz;
  private game = (res: GameResponse) => res.data.game;

  // --- The quizzes ---

  // Everyone's, without the questions.
  getQuizzes(): Observable<Quiz[]> {
    return this.http
      .get<{ data: { quizzes: Quiz[] } }>(this.quizzesUrl)
      .pipe(map((res) => res.data.quizzes));
  }

  // With its questions - my own only.
  getQuiz(id: string): Observable<Quiz> {
    return this.http.get<QuizResponse>(`${this.quizzesUrl}/${id}`).pipe(map(this.quiz));
  }

  createQuiz(draft: QuizDraft): Observable<Quiz> {
    return this.http.post<QuizResponse>(this.quizzesUrl, draft).pipe(map(this.quiz));
  }

  updateQuiz(id: string, draft: QuizDraft): Observable<Quiz> {
    return this.http.put<QuizResponse>(`${this.quizzesUrl}/${id}`, draft).pipe(map(this.quiz));
  }

  deleteQuiz(id: string): Observable<void> {
    return this.http.delete<void>(`${this.quizzesUrl}/${id}`);
  }

  // --- A question's picture ---

  // One of my own (shrunk on the phone first - shared/image-resize.ts);
  // the answer is the name the question then carries.
  uploadImage(image: Blob): Observable<string> {
    const form = new FormData();
    form.append('image', image, 'kep.jpg');
    return this.http
      .post<{ data: { image: string } }>(`${this.apiUrl}/images`, form)
      .pipe(map((res) => res.data.image));
  }

  // A photo of a tour's album: the quiz gets a copy of its own.
  imageFromTour(tourId: string, filename: string): Observable<string> {
    return this.http
      .post<{ data: { image: string } }>(`${this.apiUrl}/images/from-tour`, { tourId, filename })
      .pipe(map((res) => res.data.image));
  }

  // A plain URL for <img> - auth rides on the session cookie.
  imageUrl(name: string): string {
    return `${this.apiUrl}/images/${name}`;
  }

  // A game of my quiz: it waits in the lobby for the players.
  startGame(quizId: string): Observable<QuizGame> {
    return this.http
      .post<GameResponse>(`${this.quizzesUrl}/${quizId}/games`, {})
      .pipe(map(this.game));
  }

  // --- The games ---

  getGames(): Observable<QuizGameSummary[]> {
    return this.http
      .get<{ data: { games: QuizGameSummary[] } }>(this.gamesUrl)
      .pipe(map((res) => res.data.games));
  }

  getLeaderboard(): Observable<QuizLeader[]> {
    return this.http
      .get<{ data: { players: QuizLeader[] } }>(`${this.apiUrl}/leaderboard`)
      .pipe(map((res) => res.data.players));
  }

  // Which live game a code belongs to.
  findByPin(pin: string): Observable<string> {
    return this.http
      .get<{ data: { gameId: string } }>(`${this.gamesUrl}/pin/${encodeURIComponent(pin)}`)
      .pipe(map((res) => res.data.gameId));
  }

  getGame(id: string): Observable<QuizGame> {
    return this.http.get<GameResponse>(`${this.gamesUrl}/${id}`).pipe(map(this.game));
  }

  // The game's link as a QR code (a PNG data URL) - for its host.
  getQr(id: string): Observable<string> {
    return this.http
      .get<{ data: { qr: string } }>(`${this.gamesUrl}/${id}/qr`, {
        params: { origin: window.location.origin },
      })
      .pipe(map((res) => res.data.qr));
  }

  // Each of these answers the game as it now stands.
  join(id: string): Observable<QuizGame> {
    return this.http.post<GameResponse>(`${this.gamesUrl}/${id}/join`, {}).pipe(map(this.game));
  }

  // The host's one button: start, close the question, the next one, the end.
  next(id: string): Observable<QuizGame> {
    return this.http.post<GameResponse>(`${this.gamesUrl}/${id}/next`, {}).pipe(map(this.game));
  }

  answer(id: string, answer: number): Observable<QuizGame> {
    return this.http
      .post<GameResponse>(`${this.gamesUrl}/${id}/answers`, { answer })
      .pipe(map(this.game));
  }

  // The host calls it off.
  abandon(id: string): Observable<QuizGame> {
    return this.http.post<GameResponse>(`${this.gamesUrl}/${id}/abandon`, {}).pipe(map(this.game));
  }
}
