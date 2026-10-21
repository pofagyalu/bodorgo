import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { API } from '../../../../testing/http';
import {
  FakeSocket,
  Failure,
  fail,
  logIn,
  pageTesting,
  respond,
  settle,
  waiting,
} from '../../../../testing/component';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import {
  DEFAULT_SCORING,
  Quiz,
  QuizGame,
  QuizGameSummary,
  QuizPlayer,
  QuizQuestion,
  QuizScoring,
  QuizScoringView,
} from '../../../services/quiz';
import { TourSocketService } from '../../../services/tour-socket';
import { Moka } from '../moka';
import { QuizPhotoPicker } from './quiz-edit/photo-picker/photo-picker';
import { QuizEdit } from './quiz-edit/quiz-edit';
import { QuizPreview } from './quiz-edit/quiz-preview/quiz-preview';
import { QuizSongPicker } from './quiz-edit/song-picker/song-picker';
import { QuizQuestionView } from './quiz-question/quiz-question';
import { QuizStandings } from './quiz-standings/quiz-standings';
import { QuizGamePage } from './quiz-game/quiz-game';
import { QuizHome } from './quiz-home';
import { QuizList } from './quiz-list/quiz-list';
import { QuizScoringPage } from './quiz-scoring/quiz-scoring';

const quizzes = `${API}/jatekok/quiz/quizzes`;
const games = `${API}/jatekok/quiz/games`;

// The server's clock in these tests - an hour ahead of the phone's.
const serverNow = () => Date.now() + 3600_000;
const at = (ms: number) => new Date(ms).toISOString();

const player = (userId: string, name: string, over: Partial<QuizPlayer> = {}): QuizPlayer => ({
  userId,
  name,
  photoUpdatedAt: null,
  score: 0,
  correct: 0,
  rank: 1,
  answered: false,
  ...over,
});

const game = (over: Partial<QuizGame> = {}): QuizGame => ({
  _id: 'g1',
  title: 'Táborok',
  pin: '123456',
  status: 'lobby',
  host: { _id: 'host', name: 'Zoli' },
  createdAt: '2026-01-01',
  finishedAt: null,
  questionCount: 2,
  questionIdx: -1,
  players: [],
  question: null,
  serverNow: at(serverNow()),
  ...over,
});

// The first question, open - `sentAt`: when the server said so.
const asked = (over: Partial<QuizGame> = {}, sentAt = serverNow()): QuizGame =>
  game({
    status: 'question',
    questionIdx: 0,
    players: [player('me', 'Én'), player('u2', 'Béla', { rank: 2 })],
    question: {
      type: 'choice',
      text: 'Hol volt az első tábor?',
      answers: ['Mátra', 'Bükk', 'Zemplén'],
      timeLimitSec: 20,
      startedAt: at(sentAt),
      endsAt: at(sentAt + 20_000),
    },
    serverNow: at(sentAt),
    ...over,
  });

const quiz = (over: Partial<Quiz> = {}): Quiz => ({
  _id: 'q1',
  title: 'Táborok',
  questionCount: 1,
  createdBy: { _id: 'me', name: 'Én' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  mine: true,
  ...over,
});

const scoringView = (
  scoring: Partial<QuizScoring> = {},
  over: Partial<QuizScoringView> = {},
): QuizScoringView => ({
  scoring: { ...DEFAULT_SCORING, ...scoring },
  maxPoints: 1000,
  maxStreakSteps: 5,
  updatedAt: null,
  canEdit: false,
  ...over,
});

let http: HttpTestingController;
let error: ReturnType<typeof vi.spyOn>;
let navigate: ReturnType<typeof vi.spyOn>;

function setUp(providers: unknown[] = [], me = 'me') {
  TestBed.configureTestingModule({ providers: [pageTesting(), ...providers] });
  http = TestBed.inject(HttpTestingController);
  const notifications = TestBed.inject(NotificationsService);
  error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
  vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // "reduced motion": the confetti needs a real canvas, which jsdom lacks
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  logIn({ role: 'member', id: me });
}

const routeWith = (params: Record<string, string>) => ({
  provide: ActivatedRoute,
  useValue: { snapshot: { paramMap: convertToParamMap(params) } },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('QuizGamePage', () => {
  let fixture: ComponentFixture<QuizGamePage>;
  let page: QuizGamePage;
  let socket: FakeSocket;

  function open(reply: QuizGame | Failure, me = 'me') {
    setUp([routeWith({ id: 'g1' })], me);
    socket = TestBed.inject(TourSocketService) as unknown as FakeSocket;
    fixture = TestBed.createComponent(QuizGamePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /jatekok/quiz/games/g1': reply instanceof Failure ? reply : dataOf(reply) });
    fixture.detectChanges();
  }

  const dataOf = (g: QuizGame) => ({ data: { game: g } });
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('lets nobody zoom the page while a game is open - and gives it back on leaving', () => {
    const root = document.documentElement.classList;
    expect(root.contains('no-pinch-zoom')).toBe(false);
    open(game());
    expect(root.contains('no-pinch-zoom')).toBe(true);
    fixture.destroy();
    expect(root.contains('no-pinch-zoom')).toBe(false);
  });

  it('steps a player into a game still on, and follows it live', () => {
    open(game());
    expect(socket.joinQuiz).toHaveBeenCalledWith('g1');
    expect(page.isHost()).toBe(false);
    respond({
      'POST /jatekok/quiz/games/g1/join': dataOf(
        game({ players: [player('me', 'Én')], myAnswer: null }),
      ),
    });
    fixture.detectChanges();
    expect(page.me()?.name).toBe('Én');
    expect(text()).toContain('Bent vagy!');

    // Someone else arrives; another game's news is not this page's.
    socket.fire(
      'quiz-game',
      game({ players: [player('me', 'Én'), player('u2', 'Béla', { rank: 2 })] }),
    );
    socket.fire('quiz-game', game({ _id: 'other', status: 'abandoned' }));
    fixture.detectChanges();
    expect(page.game()?.players).toHaveLength(2);
    expect(page.live()).toBe(true);

    fixture.destroy();
    expect(socket.leaveQuiz).toHaveBeenCalledWith('g1');
  });

  it('gives the host the code and its QR, and the button that starts', () => {
    open(game({ players: [player('u2', 'Béla')] }), 'host');
    respond({ 'GET /jatekok/quiz/games/g1/qr': { data: { qr: 'data:image/png;base64,AAAA' } } });
    fixture.detectChanges();
    expect(page.isHost()).toBe(true);
    expect(page.qr()).toContain('data:image/png');
    expect(text()).toContain('123456');
    expect(waiting()).toEqual([]); // the host doesn't join

    page.next();
    page.next(); // a second tap while the first is on its way does nothing
    http.expectOne(`${games}/g1/next`).flush(dataOf(asked({ myAnswer: null })));
    fixture.detectChanges();
    expect(page.game()?.status).toBe('question');
    expect(page.canAnswer()).toBe(false);
    expect(text()).toContain('Kérdés lezárása');
    expect(text()).toContain('0 / 2 válaszolt');
  });

  it('counts down by the server’s clock, not the phone’s', () => {
    open(asked({ myAnswer: null }));
    expect(page.secondsLeft()).toBeGreaterThanOrEqual(19);
    expect(page.secondsLeft()).toBeLessThanOrEqual(20);
    expect(page.timeLeft()).toBeGreaterThan(0.95);
    expect(page.isLast()).toBe(false);
  });

  it('sends my answer once, and shows what it came to when the question closes', () => {
    open(asked({ myAnswer: null }));
    expect(page.canAnswer()).toBe(true);
    page.answer(1);
    page.answer(0); // one answer each
    expect(page.myAnswer()).toBe(1);
    const req = http.expectOne(`${games}/g1/answers`);
    expect(req.request.body).toEqual({ answer: 1 });
    req.flush(dataOf(asked({ myAnswer: 1 })));
    fixture.detectChanges();
    expect(text()).toContain('Válasz elküldve');

    // Sent to everyone: my answer isn't in it, but stays.
    const closed = asked({
      status: 'reveal',
      players: [
        player('u2', 'Béla', { score: 900, correct: 1, answered: true, answer: 1, points: 900 }),
        player('me', 'Én', {
          rank: 2,
          score: 700,
          correct: 1,
          answered: true,
          answer: 1,
          points: 700,
        }),
      ],
      serverNow: at(serverNow() + 5000),
    });
    closed.question = { ...closed.question!, correct: 1, counts: [0, 2, 0] };
    socket.fire('quiz-game', closed);
    // An older one arriving late is dropped.
    socket.fire('quiz-game', asked({}, serverNow() - 60_000));
    fixture.detectChanges();

    expect(page.game()?.status).toBe('reveal');
    expect(page.myAnswer()).toBe(1);
    expect(page.myResult()).toBe('right');
    expect(page.answeredCount()).toBe(2);
    const bars = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.bar')];
    expect(bars.map((b) => b.style.width)).toEqual(['0%', '100%', '0%']);
    expect(page.top().map((p) => p.name)).toEqual(['Béla', 'Én']);
    expect(text()).toContain('+700 pont');
    expect(text()).toContain('Mindjárt jön az állás');
  });

  it('takes the tap back if the answer could not be sent', () => {
    open(asked({ myAnswer: null }));
    page.answer(2);
    http
      .expectOne(`${games}/g1/answers`)
      .flush({ message: 'Lejárt.' }, { status: 400, statusText: 'x' });
    expect(error).toHaveBeenCalledWith('Lejárt.');
    respond({
      'GET /jatekok/quiz/games/g1': dataOf(
        asked({ myAnswer: null, serverNow: at(serverNow() + 1) }),
      ),
    });
    expect(page.myAnswer()).toBeNull();
  });

  it('says how a wrong or a missing answer went, and forgets my answer on the next question', () => {
    const closed = (mine: Partial<QuizPlayer>) => {
      const g = asked({ status: 'reveal', myAnswer: mine.answer ?? null });
      g.players = [player('me', 'Én', { answered: mine.answer != null, points: 0, ...mine })];
      g.question = { ...g.question!, correct: 1, counts: [1, 0, 0] };
      return g;
    };
    open(closed({ answer: 0 }));
    expect(page.myResult()).toBe('wrong');
    socket.fire('quiz-game', {
      ...closed({ answer: null }),
      myAnswer: undefined,
      serverNow: at(serverNow() + 1000),
    });
    expect(page.myResult()).toBe('none');

    socket.fire('quiz-game', asked({ questionIdx: 1, serverNow: at(serverNow() + 2000) }));
    expect(page.myAnswer()).toBeNull();
    expect(page.isLast()).toBe(true);
    expect(page.myResult()).toBeNull();
  });

  it('uncovers a picture question’s picture tile by tile, all of it once the question is closed', () => {
    const pictured = (over: Partial<QuizGame>, elapsed: number) => {
      const sentAt = serverNow();
      const g = asked({ myAnswer: null, ...over }, sentAt);
      g.question = {
        ...g.question!,
        type: 'picture',
        image: 'a'.repeat(24),
        startedAt: at(sentAt - elapsed),
        endsAt: at(sentAt - elapsed + 20_000),
      };
      return g;
    };
    open(pictured({}, 0));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLImageElement>('.picture img')?.src).toContain(
      `/jatekok/quiz/images/${'a'.repeat(24)}`,
    );
    // Every tile is there, and none is off yet.
    expect(el.querySelectorAll('.tiles span')).toHaveLength(48);
    expect(el.querySelectorAll('.tiles .gone')).toHaveLength(0);

    // Halfway through the time: more than half of them are off.
    socket.fire('quiz-game', { ...pictured({}, 10_000), myAnswer: undefined });
    fixture.detectChanges();
    const gone = el.querySelectorAll('.tiles .gone').length;
    expect(gone).toBeGreaterThan(24);
    expect(gone).toBeLessThan(48);

    socket.fire('quiz-game', { ...pictured({ status: 'reveal' }, 12_000), myAnswer: undefined });
    fixture.detectChanges();
    expect(el.querySelectorAll('.tiles .gone')).toHaveLength(48);
  });

  it('has no picture on a plain question', () => {
    open(asked({ myAnswer: null }));
    expect((fixture.nativeElement as HTMLElement).querySelector('.picture')).toBeNull();
  });

  it('shows the standings between two questions, until the host starts the next one', () => {
    const standing = game({
      status: 'standings',
      questionIdx: 0,
      players: [
        player('u2', 'Béla', { score: 900, points: 900 }),
        player('me', 'Én', { rank: 2, score: 700, points: 700 }),
      ],
    });
    open(standing);
    expect(page.live()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-quiz-standings')).not.toBeNull();
    expect(text()).toContain('Jön a(z) 2. kérdés');
    expect(el.querySelector('.lead-btn')).toBeNull();

    fixture.destroy();
    TestBed.resetTestingModule();
    open(standing, 'host');
    expect(text()).toContain('Következő kérdés');
  });

  it('lets me put a pin on a map question and move it, and says how far off it was', () => {
    const bounds = { south: 45.7, west: 16.1, north: 48.6, east: 22.9 };
    const mapped = (over: Partial<QuizGame> = {}) => {
      const g = asked({ myAnswer: null, myGuess: null, ...over });
      g.question = { ...g.question!, type: 'map', answers: [], bounds };
      return g;
    };
    open(mapped());
    expect(text()).toContain('Koppints a térképre');

    page.putPin({ lat: 47.6, lng: 19 });
    expect(page.myGuess()).toEqual({ lat: 47.6, lng: 19 });
    const first = http.expectOne(`${games}/g1/answers`);
    expect(first.request.body).toEqual({ lat: 47.6, lng: 19 });
    first.flush(
      dataOf(mapped({ myGuess: { lat: 47.6, lng: 19 }, serverNow: at(serverNow() + 1) })),
    );
    fixture.detectChanges();
    expect(text()).toContain('áthelyezheted');
    // It may be moved while the question is open.
    expect(page.canAnswer()).toBe(true);
    page.putPin({ lat: 47.9, lng: 20.4 });
    http
      .expectOne(`${games}/g1/answers`)
      .flush({ message: 'Lejárt.' }, { status: 400, statusText: 'x' });
    expect(error).toHaveBeenCalledWith('Lejárt.');
    respond({ 'GET /jatekok/quiz/games/g1': dataOf(mapped({ serverNow: at(serverNow() + 2) })) });

    // Closed: the place, everyone's pins, and what mine came to.
    const closed = mapped({ status: 'reveal', serverNow: at(serverNow() + 9000) });
    closed.question = { ...closed.question!, place: { lat: 47.9, lng: 20.37 }, counts: [] };
    closed.players = [
      player('me', 'Én', {
        answered: true,
        points: 880,
        km: 36.5,
        guess: { lat: 47.6, lng: 20.2 },
      }),
      player('u2', 'Béla', { rank: 2, points: 0, km: null, guess: null }),
    ];
    socket.fire('quiz-game', { ...closed, myAnswer: undefined, myGuess: undefined });
    fixture.detectChanges();
    expect(page.myResult()).toBe('far');
    expect(page.myPin()).toEqual({ lat: 47.6, lng: 20.2 });
    expect(page.mapGuesses()).toEqual([{ lat: 47.6, lng: 20.2, name: 'Én', me: true }]);
    expect(text()).toContain('36.5 km-re voltál');
    expect(text()).toContain('+880 pont');
    expect(page.canAnswer()).toBe(false);
  });

  it('plays a song question’s song on the host’s device only - with a button if the browser wants a tap', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('x'));
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const sung = (over: Partial<QuizGame> = {}) => {
      const g = asked({ myAnswer: null, ...over });
      g.question = { ...g.question!, type: 'song' };
      return g;
    };
    // A player's phone stays silent.
    open(sung());
    await settle();
    expect(play).not.toHaveBeenCalled();
    expect(text()).toContain('Szól a zene');

    fixture.destroy();
    TestBed.resetTestingModule();
    open(sung(), 'host');
    await settle();
    fixture.detectChanges();
    expect(play).toHaveBeenCalledTimes(1);
    expect(page.songBlocked()).toBe(true);
    expect(text()).toContain('Zene indítása');

    play.mockResolvedValue(undefined);
    page.startSong();
    await settle();
    expect(page.songBlocked()).toBe(false);

    // Which song it was, once the question is closed.
    const closed = sung({ status: 'reveal', serverNow: at(serverNow() + 5000) });
    closed.question = {
      ...closed.question!,
      correct: 0,
      counts: [0, 0, 0],
      song: { title: 'Tavaszi szél', artist: 'Népdal' },
    };
    socket.fire('quiz-game', closed);
    fixture.detectChanges();
    expect(text()).toContain('Tavaszi szél');

    // The game over: the song stops for good, its download too - a paused
    // one went on asking the server, which refuses it now (2026-10-17).
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const removeSrc = vi.spyOn(HTMLMediaElement.prototype, 'removeAttribute');
    socket.fire(
      'quiz-game',
      game({ status: 'finished', pin: null, serverNow: at(serverNow() + 9000) }),
    );
    fixture.detectChanges();
    expect(removeSrc).toHaveBeenCalledWith('src');
    expect(load).toHaveBeenCalled();
  });

  it('puts the winners on the podium at the end', async () => {
    open(asked({ status: 'reveal', myAnswer: null }));
    const over = game({
      status: 'finished',
      pin: null,
      questionIdx: 1,
      players: [
        player('u2', 'Béla', { score: 1800 }),
        player('me', 'Én', { rank: 2, score: 900 }),
        player('u3', 'Cili', { rank: 3 }),
        player('u4', 'Dani', { rank: 4 }),
      ],
      serverNow: at(serverNow() + 9000),
    });
    socket.fire('quiz-game', over);
    fixture.detectChanges();
    await settle();
    expect(page.live()).toBe(false);
    expect(page.winners().map((w) => [w.place, w.name])).toEqual([
      [1, 'Béla'],
      [2, 'Én'],
      [3, 'Cili'],
    ]);
    expect(text()).toContain('Vége a kvíznek!');
    expect(text()).toContain('Dani');
  });

  it('lets the host call the game off - after asking', async () => {
    open(game(), 'host');
    respond({ 'GET /jatekok/quiz/games/g1/qr': fail(400) });
    const ask = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(false);
    await page.abandon();
    http.expectNone(`${games}/g1/abandon`);

    ask.mockResolvedValue(true);
    await page.abandon();
    http.expectOne(`${games}/g1/abandon`).flush(dataOf(game({ status: 'abandoned', pin: null })));
    fixture.detectChanges();
    expect(text()).toContain('megszakította');
  });

  it('asks for the game again after a reconnect, and says so when there is none', () => {
    open(fail(404));
    expect(page.missing()).toBe(true);
    expect(text()).toContain('Nincs ilyen játék.');
    socket.fire('connect', undefined);
    http.expectOne(`${games}/g1`).flush(dataOf(game({ status: 'finished', pin: null })));
    expect(page.game()?.status).toBe('finished');
    // Over: nothing to join.
    expect(waiting()).toEqual([]);
  });

  it('reports a failed step of the host', () => {
    open(game({ players: [] }), 'host');
    respond({ 'GET /jatekok/quiz/games/g1/qr': { data: { qr: 'data:image/png;base64,AAAA' } } });
    page.next();
    http
      .expectOne(`${games}/g1/next`)
      .flush({ message: 'Még senki sem csatlakozott.' }, { status: 400, statusText: 'x' });
    expect(error).toHaveBeenCalledWith('Még senki sem csatlakozott.');
    expect(page.busy()).toBe(false);
  });
});

describe('QuizHome', () => {
  const summary = (over: Partial<QuizGameSummary> = {}): QuizGameSummary => ({
    _id: 'g1',
    title: 'Táborok',
    status: 'finished',
    host: { _id: 'host', name: 'Zoli' },
    createdAt: '2026-01-01T10:00:00Z',
    finishedAt: '2026-01-01T10:20:00Z',
    questionCount: 5,
    playerCount: 2,
    winners: [{ place: 1, userId: 'u2', name: 'Béla', photoUpdatedAt: null, score: 900 }],
    ...over,
  });

  function open(
    list: QuizGameSummary[] | Failure = [
      summary(),
      summary({ _id: 'g2', status: 'lobby', winners: [] }),
    ],
  ) {
    setUp();
    const fixture = TestBed.createComponent(QuizHome);
    fixture.detectChanges();
    respond({
      'GET /jatekok/quiz/games': list instanceof Failure ? list : { data: { games: list } },
      'GET /jatekok/quiz/leaderboard': {
        data: {
          results: [
            {
              userId: 'u2',
              name: 'Béla',
              photoUpdatedAt: null,
              average: 843.75,
              points: 3375,
              games: 2,
              questions: 4,
            },
          ],
        },
      },
    });
    fixture.detectChanges();
    return fixture;
  }

  it('shows the games on now, the leaderboard and the games played with their winners', () => {
    const fixture = open();
    const page = fixture.componentInstance;
    expect(page.live().map((g) => g._id)).toEqual(['g2']);
    expect(page.played().map((g) => g._id)).toEqual(['g1']);
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Most megy');
    expect(text).toContain('🥇 Béla');
    expect(text).toContain('Ranglista');
    const row = (fixture.nativeElement as HTMLElement).querySelector('.leaders tbody tr');
    // Points per question to one decimal; the games and questions it's
    // from (under the name on a phone, their own columns on a big screen).
    const cells = [...(row?.querySelectorAll('td') ?? [])].map((td) =>
      td.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(cells.slice(0, 4)).toEqual(['1.', 'B Béla 2 kvíz · 4 kérdés', '2', '4']);
    // (The app's own locale writes it 843,8.)
    expect(cells[4]).toMatch(/^843[.,]8$/);
  });

  it('finds a game by its code - digits only', () => {
    const page = open([]).componentInstance;
    page.typePin('12a 34');
    page.joinByPin(); // too short: nothing asked
    expect(waiting()).toEqual([]);
    page.typePin('12 34 56 78');
    expect(page.pin()).toBe('123456');
    page.joinByPin();
    http.expectOne(`${games}/pin/123456`).flush({ data: { gameId: 'g9' } });
    expect(navigate).toHaveBeenCalledWith(['/moka/kviz/jatekok', 'g9']);
  });

  it('says so when no game has that code, or the lists cannot be loaded', () => {
    const page = open(fail(500)).componentInstance;
    expect(page.games()).toEqual([]);
    page.typePin('654321');
    page.joinByPin();
    http
      .expectOne(`${games}/pin/654321`)
      .flush({ message: 'Ilyen kóddal most nincs játék.' }, { status: 404, statusText: 'x' });
    expect(error).toHaveBeenCalledWith('Ilyen kóddal most nincs játék.');
    expect(page.joining()).toBe(false);
  });
});

describe('QuizList', () => {
  function open(list: Quiz[] | Failure) {
    setUp();
    const fixture = TestBed.createComponent(QuizList);
    fixture.detectChanges();
    respond({
      'GET /jatekok/quiz/quizzes': list instanceof Failure ? list : { data: { quizzes: list } },
    });
    fixture.detectChanges();
    return fixture;
  }

  it('lets me start, change and delete my own quizzes only', async () => {
    const fixture = open([
      quiz(),
      quiz({ _id: 'q2', mine: false, createdBy: { _id: 'u2', name: 'Béla' } }),
    ]);
    const page = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.card')).toHaveLength(2);
    expect(el.querySelectorAll('.card-actions')).toHaveLength(1);
    expect(el.textContent).toContain('készítette: Béla');

    page.start(quiz());
    page.start(quiz()); // once
    http.expectOne(`${quizzes}/q1/games`).flush({ data: { game: game() } });
    expect(navigate).toHaveBeenCalledWith(['/moka/kviz/jatekok', 'g1']);

    const ask = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(false);
    await page.remove(quiz());
    http.expectNone(`${quizzes}/q1`);
    ask.mockResolvedValue(true);
    await page.remove(quiz());
    http.expectOne({ method: 'DELETE', url: `${quizzes}/q1` }).flush(null);
    expect(page.quizzes()?.map((q) => q._id)).toEqual(['q2']);
  });

  it('reports what went wrong', async () => {
    const page = open(fail(500)).componentInstance;
    expect(page.quizzes()).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);

    page.start(quiz());
    http.expectOne(`${quizzes}/q1/games`).flush(null, { status: 500, statusText: 'x' });
    expect(page.starting()).toBeNull();

    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    await page.remove(quiz());
    http.expectOne(`${quizzes}/q1`).flush(null, { status: 403, statusText: 'x' });
    expect(error).toHaveBeenCalledTimes(3);
  });
});

describe('QuizEdit', () => {
  function open(id?: string) {
    setUp([routeWith(id ? { id } : {})]);
    const fixture = TestBed.createComponent(QuizEdit);
    fixture.detectChanges();
    return fixture;
  }

  it('lets nobody zoom the page while the phone preview of a question is open', () => {
    const root = document.documentElement.classList;
    const fixture = open();
    const page = fixture.componentInstance;
    // The form itself is zoomed as any page.
    expect(root.contains('no-pinch-zoom')).toBe(false);

    page.previewOpen.set(true);
    fixture.detectChanges();
    expect(root.contains('no-pinch-zoom')).toBe(true);
    page.previewOpen.set(false);
    fixture.detectChanges();
    expect(root.contains('no-pinch-zoom')).toBe(false);

    // Left with the preview open: the zoom comes back all the same.
    page.previewOpen.set(true);
    fixture.detectChanges();
    fixture.destroy();
    expect(root.contains('no-pinch-zoom')).toBe(false);
  });

  it('says what a new quiz still needs, and saves it without the empty answers', () => {
    const fixture = open();
    const page = fixture.componentInstance;
    expect(page.loaded()).toBe(true);
    expect(page.problem()).toContain('címet');
    page.save(); // not yet
    expect(waiting()).toEqual([]);

    page.title.set(' Táborok ');
    expect(page.problem()).toContain('1. kérdés: írd be');
    page.setText(0, 'Hol?');
    page.setAnswer(0, 0, 'Mátra');
    expect(page.problem()).toContain('legalább két válasz');
    // The first and the last slot: the right one is the last.
    page.setAnswer(0, 3, ' Bükk ');
    page.setCorrect(0, 2);
    expect(page.problem()).toContain('helyesnek jelölt válasz üres');
    page.setCorrect(0, 3);
    page.setTime(0, 30);
    expect(page.problem()).toBeNull();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 kérdés – mehet!');

    page.save();
    const req = http.expectOne({ method: 'POST', url: quizzes });
    expect(req.request.body).toEqual({
      title: 'Táborok',
      questions: [
        {
          type: 'choice',
          text: 'Hol?',
          image: null,
          answers: ['Mátra', 'Bükk'],
          correct: 1,
          timeLimitSec: 30,
        },
      ],
    });
    req.flush({ data: { quiz: quiz() } });
    expect(navigate).toHaveBeenCalledWith(['/moka/kviz/szerkeszto']);
  });

  it('adds, reorders and removes questions', async () => {
    const page = open().componentInstance;
    page.setText(0, 'Első');
    page.addQuestion();
    page.setText(1, 'Második');
    await settle();
    page.move(1, -1);
    page.move(0, -1); // already on top
    expect(page.questions().map((q) => q.text)).toEqual(['Második', 'Első']);

    const ask = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(false);
    await page.removeQuestion(0);
    expect(page.questions()).toHaveLength(2);
    ask.mockResolvedValue(true);
    await page.removeQuestion(0);
    expect(page.questions().map((q) => q.text)).toEqual(['Első']);

    // An untouched one goes without asking.
    page.addQuestion();
    ask.mockClear();
    await page.removeQuestion(1);
    expect(ask).not.toHaveBeenCalled();
    expect(page.isFull()).toBe(false);
  });

  it('loads my quiz with all four answer slots, and saves the changes', () => {
    const fixture = open('q1');
    const page = fixture.componentInstance;
    expect(page.loaded()).toBe(false);
    respond({
      'GET /jatekok/quiz/quizzes/q1': {
        data: {
          quiz: quiz({
            questions: [
              {
                type: 'choice',
                text: 'Hol?',
                answers: ['Mátra', 'Bükk'],
                correct: 1,
                timeLimitSec: 20,
              },
            ],
          }),
        },
      },
    });
    fixture.detectChanges();
    expect(page.title()).toBe('Táborok');
    expect(page.questions()[0].answers).toEqual(['Mátra', 'Bükk', '', '']);

    page.save();
    const req = http.expectOne({ method: 'PUT', url: `${quizzes}/q1` });
    req.flush({ message: 'Hiba.' }, { status: 400, statusText: 'x' });
    expect(error).toHaveBeenCalledWith('Hiba.');
    expect(page.saving()).toBe(false);
  });

  it('gives a question a picture - my own or a tour’s photo - and takes it off again', async () => {
    const fixture = open();
    const page = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    // A plain question has nowhere to put a picture; a picture question
    // can't be saved without one.
    page.title.set('Képek');
    page.setText(0, 'Hol készült?');
    page.setAnswer(0, 0, 'Mátra');
    page.setAnswer(0, 1, 'Bükk');
    fixture.detectChanges();
    expect(el.querySelector('.picture')).toBeNull();
    expect(page.problem()).toBeNull();
    page.setType(0, 'picture');
    fixture.detectChanges();
    expect(el.querySelectorAll('.picture .pic-btn')).toHaveLength(2);
    expect(page.problem()).toContain('válassz hozzá képet');
    expect(el.textContent).toContain('csempénként tárul fel');

    // A tour's photo: the picker opens for that question, the server copies it.
    page.pickingFor.set(0);
    fixture.detectChanges();
    expect(el.parentElement?.querySelector('app-quiz-photo-picker')).not.toBeNull();
    page.fromTour({ tourId: 't1', filename: 'IMG_1.jpg' });
    expect(page.pickingFor()).toBeNull();
    expect(page.uploadingFor()).toBe(0);
    const copy = http.expectOne(`${API}/jatekok/quiz/images/from-tour`);
    expect(copy.request.body).toEqual({ tourId: 't1', filename: 'IMG_1.jpg' });
    copy.flush({ data: { image: 'a'.repeat(24) } });
    fixture.detectChanges();
    expect(page.questions()[0].image).toBe('a'.repeat(24));
    expect(el.querySelector<HTMLImageElement>('.picture img')?.src).toBe(
      `${API}/jatekok/quiz/images/${'a'.repeat(24)}`,
    );
    expect(page.problem()).toBeNull();

    // Made a plain question again: saved without the picture.
    page.setType(0, 'choice');
    page.save();
    const saved = http.expectOne({ method: 'POST', url: quizzes });
    expect(saved.request.body.questions[0]).toMatchObject({ type: 'choice', image: null });
    saved.flush({ message: 'x' }, { status: 400, statusText: 'x' });
    page.setType(0, 'picture');

    page.removeImage(0);
    expect(page.questions()[0].image).toBeNull();

    // One of my own: a file that isn't a picture is refused here already...
    const pickEvent = (file: File) =>
      ({ target: { files: [file], value: 'x' } }) as unknown as Event;
    await page.pickFile(0, pickEvent(new File(['szia'], 'x.txt', { type: 'text/plain' })));
    expect(error).toHaveBeenCalledWith('Ezt a képet nem sikerült beolvasni.');
    expect(page.uploadingFor()).toBeNull();

    // ...and the server's refusal is shown.
    page.pickingFor.set(0);
    page.fromTour({ tourId: 't1', filename: 'IMG_2.jpg' });
    http
      .expectOne(`${API}/jatekok/quiz/images/from-tour`)
      .flush(
        { message: 'Nincs ilyen fénykép ehhez a táborhoz.' },
        { status: 404, statusText: 'x' },
      );
    expect(error).toHaveBeenCalledWith('Nincs ilyen fénykép ehhez a táborhoz.');
    expect(page.uploadingFor()).toBeNull();
  });

  it('goes back to the list when the quiz is not mine to edit', () => {
    open('q2');
    respond({
      'GET /jatekok/quiz/quizzes/q2': fail(403, 'Ehhez a kvízhez csak a készítője nyúlhat.'),
    });
    expect(error).toHaveBeenCalledWith('Ehhez a kvízhez csak a készítője nyúlhat.');
    expect(navigate).toHaveBeenCalledWith(['/moka/kviz/szerkeszto']);
  });
});

describe('QuizPhotoPicker', () => {
  const tour = (id: string, title: string, startDate: string) => ({ _id: id, title, startDate });

  it('lists the tours newest first, then the album without its restricted photos', () => {
    setUp();
    const fixture = TestBed.createComponent(QuizPhotoPicker);
    const picker = fixture.componentInstance;
    fixture.detectChanges();
    respond({
      'GET /tours': {
        data: {
          tours: [
            tour('t1', 'Mátra', '2024-07-01'),
            tour('t2', 'Bükk', '2025-07-01'),
            // Not started yet - no photos to pick from.
            tour('t3', 'Zemplén', '2099-07-01'),
          ],
        },
      },
    });
    fixture.detectChanges();
    expect(picker.tours()?.map((t) => t.title)).toEqual(['Bükk', 'Mátra']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('2025');

    picker.open(picker.tours()![0]);
    respond({
      'GET /tours/t2/images': {
        data: {
          images: [
            { filename: 'IMG_1.jpg', restricted: false },
            { filename: 'IMG_2.jpg', restricted: true },
          ],
        },
      },
    });
    fixture.detectChanges();
    expect(picker.photos()?.map((p) => p.filename)).toEqual(['IMG_1.jpg']);
    expect(picker.thumbUrl(picker.photos()![0])).toBe(`${API}/tours/t2/images/IMG_1.jpg/thumb`);
    // Before the first photo, a tile back to the tours.
    const tiles = (fixture.nativeElement as HTMLElement).querySelectorAll('.photos .photo');
    expect(tiles[0].classList).toContain('back-tile');
    expect(tiles[0].textContent).toContain('Vissza');
    expect(tiles).toHaveLength(2);

    const picked = vi.fn();
    const closed = vi.fn();
    picker.picked.subscribe(picked);
    picker.closed.subscribe(closed);
    picker.pick(picker.photos()![0]);
    expect(picked).toHaveBeenCalledWith({ tourId: 't2', filename: 'IMG_1.jpg' });

    picker.back();
    expect(picker.tour()).toBeNull();
    picker.close();
    expect(closed).toHaveBeenCalled();
  });

  it('offers a guest only the tours they were on', () => {
    setUp();
    logIn({ role: 'guest' });
    const fixture = TestBed.createComponent(QuizPhotoPicker);
    const picker = fixture.componentInstance;
    fixture.detectChanges();
    respond({
      'GET /tours': {
        data: { tours: [tour('t1', 'Mátra', '2024-07-01'), tour('t2', 'Bükk', '2025-07-01')] },
      },
      'GET /users/me/attendance': { data: { tours: [{ tour: { _id: 't1' } }] } },
    });
    expect(picker.tours()?.map((t) => t.title)).toEqual(['Mátra']);
  });

  it('shows nothing to pick when the lists cannot be loaded', () => {
    setUp();
    const fixture = TestBed.createComponent(QuizPhotoPicker);
    const picker = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /tours': fail(500) });
    expect(picker.tours()).toEqual([]);
    picker.open(tour('t1', 'Mátra', '2024-07-01') as never);
    respond({ 'GET /tours/t1/images': fail(500) });
    expect(picker.photos()).toEqual([]);
  });
});

describe('QuizEdit: the kinds of question', () => {
  function open() {
    setUp([routeWith({})]);
    const fixture = TestBed.createComponent(QuizEdit);
    fixture.detectChanges();
    const page = fixture.componentInstance;
    page.title.set('Vegyes');
    page.setText(0, 'Kérdés');
    return { fixture, page, el: fixture.nativeElement as HTMLElement };
  }

  /** What would be saved of the open question. */
  function saved(page: QuizEdit) {
    page.save();
    const req = http.expectOne({ method: 'POST', url: quizzes });
    req.flush({ message: 'x' }, { status: 400, statusText: 'x' });
    return req.request.body.questions[0];
  }

  it('offers six kinds, one question open at a time', () => {
    const { fixture, page, el } = open();
    expect(el.querySelectorAll('.kinds .choice')).toHaveLength(6);
    page.addQuestion();
    fixture.detectChanges();
    expect(page.selected()).toBe(1);
    expect(el.querySelectorAll('.q-nav .q-item')).toHaveLength(3); // two questions + "new"
    expect(el.querySelectorAll('.card.question')).toHaveLength(1);
    expect(el.querySelector('.q-head strong')?.textContent).toBe('2. kérdés');

    // The open question stays the open one when it's moved; removing it
    // opens the one that takes its place.
    page.setText(1, 'Második');
    page.move(1, -1);
    expect(page.selected()).toBe(0);
    expect(page.questions()[0].text).toBe('Második');
    page.select(1);
    void page.removeQuestion(1);
    expect(page.questions()).toHaveLength(2); // asked first: it has a text

    // The preview is there only for a question that is whole: until then
    // the phone's button is off, and its place says what is missing.
    fixture.detectChanges();
    const previewBtn = el.querySelector<HTMLButtonElement>('.preview-btn')!;
    expect(page.previewWaitsFor()).toContain('legalább két válasz');
    expect(previewBtn.disabled).toBe(true);
    expect(el.querySelector('app-quiz-preview')).toBeNull();
    expect(el.querySelector('.preview-wait')?.textContent).toContain('legalább két válasz');
    page.setAnswer(1, 0, 'Igen');
    page.setAnswer(1, 1, 'Nem');
    fixture.detectChanges();
    expect(page.previewWaitsFor()).toBeNull();
    expect(previewBtn.disabled).toBe(false);
    expect(el.querySelector('app-quiz-preview')).not.toBeNull();
  });

  it('true or false: no answers to write, only which one it is', () => {
    const { fixture, page, el } = open();
    page.setCorrect(0, 3);
    page.setType(0, 'truefalse');
    fixture.detectChanges();
    expect(page.questions()[0].correct).toBe(1);
    expect(el.querySelector('.form-cols .answers')).toBeNull();
    expect(el.querySelectorAll('.truth .choice')).toHaveLength(2);
    expect(page.problem()).toBeNull();
    page.setCorrect(0, 0);
    expect(saved(page)).toEqual({
      type: 'truefalse',
      text: 'Kérdés',
      timeLimitSec: 20,
      answers: [],
      correct: 0,
    });
  });

  it('a song: picked from a playlist, the answers filled in with it and three others', () => {
    const { fixture, page, el } = open();
    page.setType(0, 'song');
    expect(page.problem()).toContain('válassz hozzá dalt');
    page.pickingSongFor.set(0);
    fixture.detectChanges();
    expect(el.parentElement?.querySelector('app-quiz-song-picker')).not.toBeNull();

    const song = { playlist: 'buli' as const, id: 'c3', title: 'Buli van', artist: 'Valaki' };
    page.songPicked({ song, label: 'Valaki – Buli van', others: ['A – a', 'B – b', 'C – c'] });
    fixture.detectChanges();
    const q = page.questions()[0];
    expect(page.pickingSongFor()).toBeNull();
    expect([...q.answers].sort()).toEqual(['A – a', 'B – b', 'C – c', 'Valaki – Buli van']);
    expect(q.answers[q.correct]).toBe('Valaki – Buli van');
    expect(page.problem()).toBeNull();
    expect(page.playlistName(song)).toBe('Buli rádió');
    expect(el.querySelector('audio')?.src).toBe(`${API}/music/buli/stream/c3`);

    // Every answer can be rewritten.
    page.setAnswer(0, q.correct, 'Buli van');
    expect(saved(page)).toMatchObject({ type: 'song', song, correct: q.correct });
  });

  it('a zoom: a picture, and a tap on it for the detail it starts on', () => {
    const { fixture, page, el } = open();
    page.setType(0, 'zoom');
    page.setAnswer(0, 0, 'Anna');
    page.setAnswer(0, 1, 'Béla');
    expect(page.problem()).toContain('válassz hozzá képet');
    page.pickingFor.set(0);
    page.fromTour({ tourId: 't1', filename: 'IMG_1.jpg' });
    http
      .expectOne(`${API}/jatekok/quiz/images/from-tour`)
      .flush({ data: { image: 'b'.repeat(24) } });
    fixture.detectChanges();
    // From the middle until told otherwise.
    expect(saved(page).focus).toEqual({ x: 0.5, y: 0.5 });

    const box = el.querySelector<HTMLElement>('.focus-box')!;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      width: 400,
      height: 300,
    } as DOMRect);
    box.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 275 }));
    fixture.detectChanges();
    expect(page.questions()[0].focus).toEqual({ x: 0.25, y: 0.75 });
    expect(el.querySelector<HTMLElement>('.focus-dot')?.style.left).toBe('25%');
    expect(saved(page)).toMatchObject({
      type: 'zoom',
      image: 'b'.repeat(24),
      focus: { x: 0.25, y: 0.75 },
    });
  });

  it('a map: the place tapped, the part shown chosen - or a tour’s place taken', () => {
    const { fixture, page, el } = open();
    page.setType(0, 'map');
    fixture.detectChanges();
    expect(el.querySelector('app-quiz-map')).not.toBeNull();
    expect(el.querySelector('.form-cols .answers')).toBeNull();
    expect(page.problem()).toContain('koppints a térképen');

    page.setPlace(0, { lat: 47.9, lng: 20.37 });
    expect(page.problem()).toBeNull();
    // The map moved off the place: it can't be saved like that.
    page.setBounds(0, { south: 46, west: 16, north: 47, east: 18 });
    expect(page.problem()).toContain('nincs a térkép látható részén');

    // A tour's place: the map is moved over it, the same size.
    page.showTours(0);
    http.expectOne(`${API}/tours`).flush({
      data: {
        tours: [
          {
            _id: 't1',
            title: 'Mátra',
            startDate: '2024-07-01',
            location: { coordinates: [19.9, 47.87] },
          },
          { _id: 't2', title: 'Sehol', startDate: '2025-07-01', location: { coordinates: [] } },
        ],
      },
    });
    fixture.detectChanges();
    expect(el.querySelectorAll('.tour-list button')).toHaveLength(2);
    expect(page.tourYear(page.tours()![0])).toBe(2025);
    page.placeFromTour(0, page.tours()![0]);
    expect(error).toHaveBeenCalledWith('Ennek a tábornak nincs megadva a helye.');
    page.placeFromTour(0, page.tours()![1]);
    const q = page.questions()[0];
    expect(q.place).toEqual({ lat: 47.87, lng: 19.9 });
    expect(q.bounds).toEqual({ south: 47.37, north: 48.37, west: 18.9, east: 20.9 });
    expect(page.toursFor()).toBeNull();
    expect(saved(page)).toEqual({
      type: 'map',
      text: 'Kérdés',
      timeLimitSec: 20,
      answers: [],
      correct: 0,
      place: q.place,
      bounds: q.bounds,
    });
  });

  it('a map: the place given by its coordinates, typed or pasted as a pair', () => {
    const { fixture, page, el } = open();
    page.setType(0, 'map');
    fixture.detectChanges();
    const fields = () => [...el.querySelectorAll('.coords input')] as HTMLInputElement[];
    expect(fields().map((f) => f.value)).toEqual(['', '']);

    // One of the two alone is not a place yet.
    page.setCoords(0, '47.497913', '');
    expect(page.questions()[0].place).toBeUndefined();
    // Both (a decimal comma too): the pin exactly there, shown in the fields.
    page.setCoords(0, '47,497913', ' 19.040236 ');
    expect(page.questions()[0].place).toEqual({ lat: 47.497913, lng: 19.040236 });
    expect(page.problem()).toBeNull();
    fixture.detectChanges();
    expect(fields().map((f) => f.value)).toEqual(['47.497913', '19.040236']);

    // Not on the part shown: the map is moved over it, the same size.
    page.setBounds(0, { south: 46, west: 16, north: 47, east: 18 });
    page.setCoords(0, '48', '21');
    expect(page.questions()[0].bounds).toEqual({ south: 47.5, north: 48.5, west: 20, east: 22 });

    // No such place.
    page.setCoords(0, '95', '21');
    page.setCoords(0, 'itt', '21');
    expect(error).toHaveBeenCalledTimes(2);
    expect(page.questions()[0].place).toEqual({ lat: 48, lng: 21 });

    // A pair pasted into a field fills both; anything else is pasted as usual.
    const paste = (text: string) => {
      const event = { clipboardData: { getData: () => text }, preventDefault: vi.fn() };
      page.pasteCoords(0, event as unknown as ClipboardEvent);
      return event.preventDefault;
    };
    expect(paste('47.87, 19.9')).toHaveBeenCalled();
    expect(page.questions()[0].place).toEqual({ lat: 47.87, lng: 19.9 });
    expect(paste('47.87')).not.toHaveBeenCalled();
  });
});

describe('QuizSongPicker', () => {
  it('offers the playlists I may hear, searches them, and adds three others to the song picked', () => {
    setUp();
    const fixture = TestBed.createComponent(QuizSongPicker);
    const picker = fixture.componentInstance;
    fixture.detectChanges();
    const track = (id: string, artist: string, title: string) => ({ id, artist, title });
    respond({
      'GET /music/bodorgo-fm/playlist': {
        data: {
          tracks: [
            track('a1', 'Népdal', 'Tavaszi szél'),
            track('b2', 'Kormorán', 'Az a szép'),
            track('c3', 'LGT', 'Neked írom a dalt'),
            track('d4', 'Omega', 'Gyöngyhajú lány'),
            track('e5', 'Omega', 'Gyöngyhajú lány'), // written the same: offered once
          ],
        },
      },
      'GET /music/buli/playlist': fail(403),
      'GET /music/hatter/playlist': { data: { tracks: [track('x1', 'Valaki', 'Halk dal')] } },
    });
    fixture.detectChanges();
    expect(picker.lists()?.map((l) => l.name)).toEqual(['Bódorgó FM', 'Duruzsoló']);
    expect(picker.current()).toBe('bodorgo-fm');

    picker.search.set('omega');
    expect(picker.tracks().map((t) => t.id)).toEqual(['d4', 'e5']);
    picker.show('hatter');
    expect(picker.search()).toBe('');
    expect(picker.tracks()).toHaveLength(1);

    const picked = vi.fn();
    picker.picked.subscribe(picked);
    picker.show('bodorgo-fm');
    picker.pick(picker.tracks()[0]);
    const { song, label, others } = picked.mock.calls[0][0];
    expect(song).toEqual({
      playlist: 'bodorgo-fm',
      id: 'a1',
      title: 'Tavaszi szél',
      artist: 'Népdal',
    });
    expect(label).toBe('Népdal – Tavaszi szél');
    expect([...others].sort()).toEqual([
      'Kormorán – Az a szép',
      'LGT – Neked írom a dalt',
      'Omega – Gyöngyhajú lány',
    ]);

    const closed = vi.fn();
    picker.closed.subscribe(closed);
    picker.close();
    expect(closed).toHaveBeenCalled();
  });
});

describe('QuizQuestionView', () => {
  it('zooms out of a picture from the detail it starts on', () => {
    setUp();
    const fixture = TestBed.createComponent(QuizQuestionView);
    const set = (name: string, value: unknown) => fixture.componentRef.setInput(name, value);
    set('question', {
      type: 'zoom',
      text: 'Ki ez?',
      answers: ['Anna', 'Béla'],
      image: 'a'.repeat(24),
      focus: { x: 0.25, y: 0.75 },
    });
    fixture.detectChanges();
    const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.picture img')!;
    expect(img.style.transform).toBe('scale(10)');
    expect(img.style.transformOrigin).toBe('25% 75%');

    set('timeLeft', 0.575); // half of the way to "all shown"
    fixture.detectChanges();
    expect(fixture.componentInstance.zoomScale()).toBeCloseTo(Math.sqrt(10), 2);

    set('open', false);
    fixture.detectChanges();
    expect(img.style.transform).toBe('scale(1)');
  });
});

describe('QuizStandings', () => {
  it('opens as it stood before the last question, grows the bars, then changes the places', () => {
    vi.useFakeTimers();
    setUp();
    const fixture = TestBed.createComponent(QuizStandings);
    fixture.componentRef.setInput('players', [
      player('u2', 'Béla', { rank: 1, score: 1500, points: 900 }),
      player('me', 'Én', { rank: 2, score: 1000, points: 0 }),
      ...Array.from({ length: 8 }, (_, i) =>
        player(`x${i}`, `Más ${i}`, { rank: 3 + i, score: 100, points: 0 }),
      ),
      player('u9', 'Utolsó', { rank: 11, score: 0, points: 0 }),
    ]);
    fixture.componentRef.setInput('myId', 'me');
    fixture.detectChanges();
    const view = fixture.componentInstance;
    // The best eight are shown.
    expect(view.rows()).toHaveLength(8);
    const [bela, me] = view.rows();
    // Before: I led with 1000 against Béla's 600.
    expect([bela.before, bela.beforePlace, me.before, me.beforePlace]).toEqual([600, 1, 1000, 0]);
    expect(view.moved()).toBe(false);
    expect(view.width(bela)).toBe(40);
    expect(view.width(me)).toBe(67);

    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(view.moved()).toBe(true);
    expect(view.width(bela)).toBe(100);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('+900');
    // The bars have grown - the rows are still where they were.
    const rank = () => (fixture.nativeElement as HTMLElement).querySelector('.rank')?.textContent;
    expect([view.sorted(), rank()]).toEqual([false, '2.']);
    vi.advanceTimersByTime(1400);
    fixture.detectChanges();
    expect([view.sorted(), rank()]).toEqual([true, '1.']);

    // Someone further down still sees their own row.
    fixture.componentRef.setInput('myId', 'u9');
    expect(view.rows().at(-1)?.name).toBe('Utolsó');
    expect(view.rows()).toHaveLength(9);
  });
});

describe('QuizPreview', () => {
  const question = (over: Partial<QuizQuestion> = {}): QuizQuestion => ({
    type: 'choice',
    text: 'Hol?',
    answers: ['', 'Mátra', '', 'Bükk'],
    correct: 3,
    timeLimitSec: 20,
    ...over,
  });

  function open(q: QuizQuestion) {
    vi.useFakeTimers();
    setUp();
    const fixture = TestBed.createComponent(QuizPreview);
    fixture.componentRef.setInput('question', q);
    fixture.componentRef.setInput('label', '1 / 1');
    fixture.detectChanges();
    return { fixture, preview: fixture.componentInstance };
  }

  it('plays the question as the players get it: the clock, a tap, what it was worth', () => {
    const { fixture, preview } = open(question());
    // The filled answers only - the right one's place among them.
    expect(preview.shown()).toMatchObject({ answers: ['Mátra', 'Bükk'], text: 'Hol?' });
    expect(preview.shown().correct).toBeUndefined();
    expect(preview.phase()).toBe('idle');
    expect(preview.canAnswer()).toBe(false);
    preview.answer(1); // not started: nothing

    preview.start();
    vi.advanceTimersByTime(5000);
    expect(preview.secondsLeft()).toBe(15);
    preview.answer(1);
    expect(preview.phase()).toBe('done');
    expect(preview.shown().correct).toBe(1);
    expect(preview.outcome()).toEqual({ kind: 'right', points: 875 });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('+875 pont');

    preview.start();
    preview.answer(0);
    expect(preview.outcome()).toEqual({ kind: 'wrong', points: 0 });

    // Nothing tapped: the clock closes it.
    preview.start();
    vi.advanceTimersByTime(20_500);
    expect(preview.outcome()).toEqual({ kind: 'none', points: 0 });

    // The question changed in the editor: back to its start.
    fixture.componentRef.setInput('question', question({ text: 'Merre?' }));
    fixture.detectChanges();
    expect(preview.phase()).toBe('idle');
    expect(preview.outcome()).toBeNull();
  });

  it('true or false has its two answers; a map counts the pin where it is at the end', () => {
    const tf = open(question({ type: 'truefalse', correct: 1 })).preview;
    expect(tf.shown().answers).toEqual(['Igaz', 'Hamis']);
    tf.start();
    tf.answer(1);
    expect(tf.outcome()?.kind).toBe('right');

    TestBed.resetTestingModule();
    const bounds = { south: 45.7, west: 16.1, north: 48.6, east: 22.9 };
    const { preview } = open(
      question({ type: 'map', answers: [], place: { lat: 47.9, lng: 20.37 }, bounds }),
    );
    expect(preview.shown()).toMatchObject({ answers: [], bounds });
    preview.start();
    preview.finish();
    expect(preview.outcome()).toEqual({ kind: 'none', points: 0 });

    preview.start();
    preview.putPin({ lat: 47.68, lng: 16.59 });
    preview.putPin({ lat: 47.9, lng: 20.37 }); // moved onto the place
    expect(preview.phase()).toBe('running');
    preview.finish();
    expect(preview.outcome()).toEqual({ kind: 'far', km: 0, points: 1000 });
    expect(preview.shown().place).toEqual({ lat: 47.9, lng: 20.37 });
    preview.reset();
    expect(preview.myGuess()).toBeNull();
  });

  it('plays a song question’s song here', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { fixture, preview } = open(
      question({
        type: 'song',
        song: { playlist: 'buli', id: 'c3', title: 'Buli van', artist: 'Valaki' },
      }),
    );
    preview.start();
    expect(play).toHaveBeenCalledTimes(1);
    preview.answer(1);
    expect(preview.shown().song?.title).toBe('Buli van');
    fixture.destroy();
    expect(pause).toHaveBeenCalled();
  });
});

describe('QuizPreview with a scoring of its own set', () => {
  it('says what the answer would be worth in a game started now', () => {
    vi.useFakeTimers();
    setUp();
    const fixture = TestBed.createComponent(QuizPreview);
    fixture.componentRef.setInput('question', {
      type: 'choice',
      text: 'Hol?',
      answers: ['Mátra', 'Bükk'],
      correct: 0,
      timeLimitSec: 20,
    });
    fixture.detectChanges();
    respond({ 'GET /jatekok/quiz/scoring': { data: scoringView({ minPoints: 200 }) } });
    const preview = fixture.componentInstance;
    preview.start();
    vi.advanceTimersByTime(5000);
    preview.answer(0);
    expect(preview.outcome()).toEqual({ kind: 'right', points: 800 });
  });
});

describe('QuizScoringPage', () => {
  function open(reply: QuizScoringView | Failure) {
    setUp();
    const fixture = TestBed.createComponent(QuizScoringPage);
    fixture.detectChanges();
    respond({ 'GET /jatekok/quiz/scoring': reply instanceof Failure ? reply : { data: reply } });
    fixture.detectChanges();
    return fixture;
  }
  const inputs = (fixture: ComponentFixture<QuizScoringPage>) => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll('input'),
  ];

  it('shows everyone what an answer is worth - to be read only', () => {
    const fixture = open(scoringView({ orderBonus: [300, 200, 100] }));
    const el = fixture.nativeElement as HTMLElement;
    expect(inputs(fixture).map((i) => [i.value, i.disabled])).toEqual([
      ['500', true],
      ['300', true],
      ['200', true],
      ['100', true],
      ['0', true],
      ['50', true],
    ]);
    expect(el.textContent).toContain('1000 pont');
    expect(el.textContent).toContain('csak a szerepkör-kezelő admin');
    expect(el.textContent).toContain('ez az alapbeállítás');
    expect(el.querySelector('.btn--save')).toBeNull();
  });

  it('lets the role manager set it: examples follow the fields, only a sound change is saved', () => {
    const fixture = open(scoringView({}, { canEdit: true, updatedAt: '2026-10-09T08:00:00Z' }));
    const page = fixture.componentInstance;
    const save = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.btn--save')!;
    expect(inputs(fixture).every((i) => !i.disabled)).toBe(true);
    // No arrows on them, nothing for the browser to check.
    expect(inputs(fixture).every((i) => i.type === 'text' && !i.step && !i.min)).toBe(true);
    expect(page.speedExample()).toEqual({ quarter: 875, half: 750 });
    expect(page.streakSteps()).toEqual([]);
    expect(page.reachKm()).toBe(330);
    expect(save().disabled).toBe(true); // nothing changed

    page.set('minPoints', '200');
    page.setBonus(0, '300');
    page.set('streakBonus', '100');
    page.set('mapReachPct', '25');
    expect(page.speedExample()).toEqual({ quarter: 800, half: 600 });
    expect(page.streakSteps().map((s) => [s.nth, s.bonus])).toEqual([
      [2, 100],
      [3, 200],
      [4, 300],
      [5, 400],
      [6, 500],
    ]);
    expect(page.reachKm()).toBe(170);

    // An empty field, a number out of bounds: not to be saved.
    page.setBonus(1, '');
    expect(page.valid()).toBe(false);
    page.save();
    expect(waiting()).toEqual([]);
    page.setBonus(1, '0');
    page.set('mapReachPct', '2');
    expect([page.valid(), page.reachKm()]).toEqual([false, null]);
    page.set('mapReachPct', '25');
    page.set('minPoints', '12.5');
    expect([page.valid(), page.speedExample()]).toEqual([false, null]);

    // The limits: at least 100 at the last moment, at least 10% on the map,
    // and a faster one never gets less than the one after it - each said
    // under its own field.
    const errors = () => {
      fixture.detectChanges();
      return [...(fixture.nativeElement as HTMLElement).querySelectorAll('.error')].map((e) =>
        e.textContent!.trim(),
      );
    };
    page.set('minPoints', '99');
    page.set('mapReachPct', '9');
    page.setBonus(1, '400');
    expect(page.valid()).toBe(false);
    expect(errors()).toEqual([
      'Legalább 100 pont legyen.',
      'Nem lehet kevesebb, mint a 2. leggyorsabb bónusza.',
      'Legalább 10% legyen.',
    ]);
    page.setBonus(1, '0');
    page.setBonus(2, '50');
    expect(errors()).toContain('Nem lehet kevesebb, mint a 3. leggyorsabb bónusza.');
    page.setBonus(2, '0');
    page.set('mapReachPct', '25');
    page.set('minPoints', 'sok');
    expect(errors()).toEqual(['Egész számot írj be.']);
    page.set('minPoints', '200');
    expect(errors()).toEqual([]);
    expect(save().disabled).toBe(false);

    const sent = { minPoints: 200, orderBonus: [300, 0, 0], mapReachPct: 25, streakBonus: 100 };
    page.save();
    page.save(); // once
    const req = http.expectOne({ method: 'PUT', url: `${API}/jatekok/quiz/scoring` });
    expect(req.request.body).toEqual(sent);
    req.flush({ data: scoringView(sent, { canEdit: true, updatedAt: '2026-10-09T09:00:00Z' }) });
    expect(page.saving()).toBe(false);
    expect(page.changed()).toBe(false);

    // Changed, then put back to what is stored.
    page.set('streakBonus', '50');
    expect(page.changed()).toBe(true);
    page.reset();
    expect(page.draft()).toEqual(sent);
  });

  it('reports what went wrong', () => {
    expect(open(fail(500)).componentInstance.draft()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    const page = open(scoringView({}, { canEdit: true })).componentInstance;
    page.set('minPoints', '300');
    page.save();
    http
      .expectOne(`${API}/jatekok/quiz/scoring`)
      .flush({ message: 'Nem jó.' }, { status: 400, statusText: 'x' });
    expect(error).toHaveBeenLastCalledWith('Nem jó.');
    expect(page.saving()).toBe(false);
    expect(page.draft()?.minPoints).toBe(300);
  });
});

describe('Moka with the quiz', () => {
  it('has the quiz’s three pages under it', () => {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/moka/kviz/pontozas');
    logIn({ role: 'guest' });
    const page = TestBed.createComponent(Moka).componentInstance;
    expect(page.subTabs().map((t) => t.label)).toEqual(['Játékszoba', 'Alkotóműhely', 'Pontozás']);
    expect(page.subTab()).toBe('kviz/pontozas');
  });

  function open(url: string, user: { role: string; canManageRoles?: boolean }) {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue(url);
    logIn(user);
    const fixture = TestBed.createComponent(Moka);
    fixture.detectChanges();
    return fixture;
  }

  it('has the race’s opening page as the first of its tabs on a phone', () => {
    const page = open('/moka/futokor', { role: 'member' }).componentInstance;
    expect(page.subTabs().map((t) => t.label)).toEqual([
      'Bemelegítés',
      'Futás',
      'Eredmények',
      'Útmutató',
      'Pályaszerkesztő',
    ]);
    // On the opening page that one is open...
    expect(page.subTab()).toBe('futokor');
  });

  it('marks the race’s own page, not the opening page above it', () => {
    expect(open('/moka/futokor/futas', { role: 'member' }).componentInstance.subTab()).toBe(
      'futokor/futas',
    );
    TestBed.resetTestingModule();
    // ...a page under one of them too (a course's results).
    expect(
      open('/moka/futokor/eredmenyek/c1?x=1', { role: 'member' }).componentInstance.subTab(),
    ).toBe('futokor/eredmenyek');
  });

  it('shows Darts, the race and the quiz to everyone', () => {
    const fixture = open('/moka/kviz/jatekok', { role: 'member' });
    const page = fixture.componentInstance;
    expect(page.inQuiz()).toBe(true);
    expect(page.seesRace()).toBe(true);
    expect(page.inGame()).toBe(false);
    const links = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.moka-nav .nav-item'),
    ];
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'track_changesDarts',
      'directions_runFutókörök',
      'quizKvíz',
    ]);
  });

  it('shows everything to the role manager, and hides the tabs during a quiz game', () => {
    const page = open('/moka/kviz/jatekok/abc123', {
      role: 'admin',
      canManageRoles: true,
    }).componentInstance;
    expect(page.seesRace()).toBe(true);
    expect(page.inGame()).toBe(true);
  });
});
