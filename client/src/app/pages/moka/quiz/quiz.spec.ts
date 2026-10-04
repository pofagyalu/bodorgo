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
import { Quiz, QuizGame, QuizGameSummary, QuizPlayer } from '../../../services/quiz';
import { TourSocketService } from '../../../services/tour-socket';
import { Moka } from '../moka';
import { QuizPhotoPicker } from './quiz-edit/photo-picker/photo-picker';
import { QuizEdit } from './quiz-edit/quiz-edit';
import { QuizGamePage } from './quiz-game/quiz-game';
import { QuizHome } from './quiz-home';
import { QuizList } from './quiz-list/quiz-list';

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
    expect(page.barWidth(1)).toBe(100);
    expect(page.barWidth(0)).toBe(0);
    expect(page.top().map((p) => p.name)).toEqual(['Béla', 'Én']);
    expect(text()).toContain('+700 pont');
    expect(text()).toContain('A következőt Zoli indítja');
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
    // Every tile has a turn of its own, and none is off yet.
    expect([...page.tileTurns()].sort((a, b) => a - b)).toEqual([...Array(48).keys()]);
    expect(page.tilesGone()).toBe(0);
    expect(el.querySelectorAll('.tiles span')).toHaveLength(48);
    expect(el.querySelectorAll('.tiles .gone')).toHaveLength(0);

    // Halfway through the time: more than half of them are off.
    socket.fire('quiz-game', { ...pictured({}, 10_000), myAnswer: undefined });
    fixture.detectChanges();
    expect(page.tilesGone()).toBeGreaterThan(24);
    expect(page.tilesGone()).toBeLessThan(48);
    expect(el.querySelectorAll('.tiles .gone')).toHaveLength(page.tilesGone());

    socket.fire('quiz-game', { ...pictured({ status: 'reveal' }, 12_000), myAnswer: undefined });
    fixture.detectChanges();
    expect(el.querySelectorAll('.tiles .gone')).toHaveLength(48);
  });

  it('has no tiles on a question without a picture', () => {
    open(asked({ myAnswer: null }));
    expect(page.tileTurns()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('.picture')).toBeNull();
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
          players: [
            {
              userId: 'u2',
              name: 'Béla',
              photoUpdatedAt: null,
              games: 1,
              firsts: 1,
              seconds: 0,
              thirds: 0,
              points: 900,
              correct: 1,
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
        { text: 'Hol?', image: null, answers: ['Mátra', 'Bükk'], correct: 1, timeLimitSec: 30 },
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
            questions: [{ text: 'Hol?', answers: ['Mátra', 'Bükk'], correct: 1, timeLimitSec: 20 }],
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
    expect(el.textContent).toContain('lassan tárul fel');

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
        data: { tours: [tour('t1', 'Mátra', '2024-07-01'), tour('t2', 'Bükk', '2025-07-01')] },
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

describe('Moka with the quiz', () => {
  function open(url: string, user: { role: string; canManageRoles?: boolean }) {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue(url);
    logIn(user);
    const fixture = TestBed.createComponent(Moka);
    fixture.detectChanges();
    return fixture;
  }

  it('shows only the quiz to whoever isn’t let into the rest yet', () => {
    const fixture = open('/moka/kviz/jatekok', { role: 'member' });
    const page = fixture.componentInstance;
    expect(page.inQuiz()).toBe(true);
    expect(page.seesAll()).toBe(false);
    expect(page.inGame()).toBe(false);
    const links = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.moka-nav .nav-item'),
    ];
    expect(links.map((a) => a.textContent?.trim())).toEqual(['quizKvíz']);
  });

  it('shows everything to the role manager, and hides the tabs during a quiz game', () => {
    const page = open('/moka/kviz/jatekok/abc123', {
      role: 'admin',
      canManageRoles: true,
    }).componentInstance;
    expect(page.seesAll()).toBe(true);
    expect(page.inGame()).toBe(true);
  });
});
