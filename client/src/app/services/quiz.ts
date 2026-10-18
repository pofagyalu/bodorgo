import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { MusicTrack, PlaylistKey } from './music-player';

// Móka → Kvíz. The rules live on the server (jatekok/quiz/scoring.js,
// quizController.js) - its clock too: the app only shows what it answers.

// What a quiz may look like (the server checks the same).
export const MIN_ANSWERS = 2;
export const MAX_ANSWERS = 4;
export const MAX_QUESTIONS = 50;
export const TIME_LIMITS = [10, 20, 30, 60];
export const DEFAULT_TIME_LIMIT = 20;

// Each answer has its own colour (the pages' .a0 - .a3) and shape (drawn
// by pages/moka/quiz/quiz-shape), wherever it's shown.
export const ANSWER_SHAPES = ['triangle', 'diamond', 'circle', 'square'] as const;
export type AnswerShape = (typeof ANSWER_SHAPES)[number];

// The kinds of question (the server's jatekok/quiz/scoring.js):
// - choice: a plain one;
// - picture: with a picture uncovered tile by tile while the clock runs;
// - zoom: with a picture that starts on a detail and zooms out;
// - truefalse: a statement - true or false;
// - song: a song plays on the host's device - which one is it;
// - map: where is it - everyone puts a pin on the map, the closest wins.
export type QuizQuestionType = 'choice' | 'picture' | 'zoom' | 'truefalse' | 'song' | 'map';
// The kinds that have a picture.
export const hasPicture = (type: QuizQuestionType) => type === 'picture' || type === 'zoom';

export interface QuizPlace {
  lat: number;
  lng: number;
}

// The part of the map that's shown.
export interface QuizBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

// What a new map question shows: Hungary and a little around it.
export const DEFAULT_BOUNDS: QuizBounds = { south: 45.5, west: 15.8, north: 48.8, east: 23.2 };

// As the crow flies, in km (as the server's jatekok/quiz/scoring.js).
export function distanceKm(a: QuizPlace, b: QuizPlace): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const diagonalKm = (b: QuizBounds) =>
  distanceKm({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east });

// Móka → Kvíz → Pontozás: what an answer is worth beyond the fixed 1000 of
// an instant right one (the server's DEFAULT_SCORING says each in full) -
// set by the role manager, for the games still to start.
export interface QuizScoring {
  // A right answer at the last moment.
  minPoints: number;
  // On top, for the fastest, 2nd and 3rd fastest right answer.
  orderBonus: number[];
  // A map question: how far a pin is still worth something, in % of the
  // shown map's diagonal.
  mapReachPct: number;
  // On top, for each right answer in a row after the first.
  streakBonus: number;
}

// What a game was scored with before there was anything to set.
export const DEFAULT_SCORING: QuizScoring = {
  minPoints: 500,
  orderBonus: [0, 0, 0],
  mapReachPct: 50,
  streakBonus: 0,
};

export interface QuizScoringView {
  scoring: QuizScoring;
  maxPoints: number; // not to be set
  maxStreakSteps: number;
  updatedAt: string | null; // null: never set yet
  canEdit: boolean;
}

// A song of one of the playlists (services/music-player.ts).
export interface QuizSong {
  playlist: PlaylistKey;
  id: string;
  title?: string;
  artist?: string;
}

// Every kind but `map` has 2-4 answers, one of them right; the rest is
// each kind's own.
export interface QuizQuestion {
  type: QuizQuestionType;
  text: string;
  answers: string[];
  correct: number; // the right answer's place in `answers`
  timeLimitSec: number;
  // picture, zoom: the picture's name on the server (QuizService.imageUrl).
  image?: string | null;
  // zoom: the detail it starts on - where in the picture's box, 0-1.
  focus?: { x: number; y: number } | null;
  song?: QuizSong | null;
  // map: the place, and the part of the map that's shown.
  place?: QuizPlace | null;
  bounds?: QuizBounds | null;
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

// lobby → question → reveal → standings → question → ... → reveal →
// finished (reveal: the answer; standings: how the game stands, before the
// next question); abandoned: called off by the host.
export type QuizGameStatus =
  'lobby' | 'question' | 'reveal' | 'standings' | 'finished' | 'abandoned';

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
  // Only once the question is closed: what they tapped, and what it was
  // worth - `bonus`: how much of that is bonus (among the fastest, a row
  // of right answers).
  answer?: number | null;
  points?: number;
  bonus?: number;
  // ...and on a map question: where their pin was, and how far off.
  guess?: QuizPlace | null;
  km?: number | null;
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
    focus?: { x: number; y: number };
    bounds?: QuizBounds;
    // Only once it's closed: where it is; which song it was.
    place?: QuizPlace;
    song?: { title: string; artist: string };
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
  // ...and on a map question, where my pin is.
  myGuess?: QuizPlace | null;
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

// One line of the leaderboard: a player over every finished game they
// played - ranked by points per question.
export interface QuizResult {
  userId: string;
  name: string;
  photoUpdatedAt: string | null;
  average: number; // points ÷ questions, unrounded
  points: number;
  games: number;
  questions: number; // in those games, answered or not
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

  // --- The scoring ---

  getScoring(): Observable<QuizScoringView> {
    return this.http
      .get<{ data: QuizScoringView }>(`${this.apiUrl}/scoring`)
      .pipe(map((res) => res.data));
  }

  // The role manager's: it counts for the games still to start.
  updateScoring(scoring: QuizScoring): Observable<QuizScoringView> {
    return this.http
      .put<{ data: QuizScoringView }>(`${this.apiUrl}/scoring`, scoring)
      .pipe(map((res) => res.data));
  }

  // --- The games ---

  getGames(): Observable<QuizGameSummary[]> {
    return this.http
      .get<{ data: { games: QuizGameSummary[] } }>(this.gamesUrl)
      .pipe(map((res) => res.data.games));
  }

  // The best players of all time, the best points per question first.
  getLeaderboard(): Observable<QuizResult[]> {
    return this.http
      .get<{ data: { results: QuizResult[] } }>(`${this.apiUrl}/leaderboard`)
      .pipe(map((res) => res.data.results));
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

  // A map question's answer: my pin - it may be moved until the time is up.
  putPin(id: string, place: QuizPlace): Observable<QuizGame> {
    return this.http
      .post<GameResponse>(`${this.gamesUrl}/${id}/answers`, place)
      .pipe(map(this.game));
  }

  // The open song question's song - a plain URL for the host's player (the
  // question's number only makes each one's address its own).
  songUrl(id: string, questionIdx: number): string {
    return `${this.gamesUrl}/${id}/song?q=${questionIdx}`;
  }

  // --- A song question's song (the editor) ---

  // A playlist's tracks to pick from.
  getTracks(playlist: PlaylistKey): Observable<MusicTrack[]> {
    return this.http
      .get<{ data: { tracks: MusicTrack[] } }>(
        `${environment.apiBaseUrl}/music/${playlist}/playlist`,
      )
      .pipe(map((res) => res.data.tracks));
  }

  // To listen to it while writing the question.
  trackUrl(song: QuizSong): string {
    return `${environment.apiBaseUrl}/music/${song.playlist}/stream/${song.id}`;
  }

  // The host calls it off.
  abandon(id: string): Observable<QuizGame> {
    return this.http.post<GameResponse>(`${this.gamesUrl}/${id}/abandon`, {}).pipe(map(this.game));
  }
}
