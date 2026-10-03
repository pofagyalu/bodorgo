import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { API } from '../../../../testing/http';
import { Failure, fail, logIn, pageTesting, respond, settle } from '../../../../testing/component';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { DartsGame, DartsPlayer, DartsTurn } from '../../../services/darts';
import { Moka } from '../moka';
import { DartBoard } from './dart-board/dart-board';
import { DartsGamePage } from './darts-game/darts-game';
import { DartsHome } from './darts-home';
import { DartsSetup } from './darts-setup/darts-setup';

const games = `${API}/jatekok/darts/games`;

const player = (idx: number, name: string, over: Partial<DartsPlayer> = {}): DartsPlayer => ({
  idx,
  userId: `u${idx}`,
  name,
  photoUpdatedAt: null,
  remaining: 301,
  darts: 0,
  points: 0,
  average: null,
  highestTurn: 0,
  position: null,
  positionFinal: false,
  ...over,
});

const turn = (
  playerIdx: number,
  throws: [number, number][],
  over: Partial<DartsTurn> = {},
): DartsTurn => ({
  playerIdx,
  round: 1,
  throws: throws.map(([segment, multiplier]) => ({ segment, multiplier })),
  startScore: 301,
  points: throws.reduce((sum, [s, m]) => sum + s * m, 0),
  bust: false,
  finished: false,
  short: false,
  editedAt: null,
  previousThrows: null,
  ...over,
});

const game = (over: Partial<DartsGame> = {}): DartsGame => ({
  _id: 'g1',
  type: 'x01',
  options: { startScore: 301, outMode: 'single' },
  status: 'in_progress',
  ended: false,
  createdBy: { _id: 'u0', name: 'Anna' },
  createdAt: '2026-01-01',
  finishedAt: null,
  players: [player(0, 'Anna'), player(1, 'Béla', { userId: null })],
  placings: [],
  canEdit: true,
  turns: [],
  next: { playerIdx: 0, round: 1, dartsLeft: 3, checkout: null },
  ...over,
});

let http: HttpTestingController;
let error: ReturnType<typeof vi.spyOn>;

function setUp(providers: unknown[] = []) {
  TestBed.configureTestingModule({ providers: [pageTesting(), ...providers] });
  http = TestBed.inject(HttpTestingController);
  error = vi.spyOn(TestBed.inject(NotificationsService), 'addError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // "reduced motion": the confetti needs a real canvas, which jsdom lacks
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DartsGamePage', () => {
  let fixture: ComponentFixture<DartsGamePage>;
  let page: DartsGamePage;
  let navigate: ReturnType<typeof vi.spyOn>;

  function open(reply: DartsGame | Failure = game()) {
    setUp([
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: 'g1' }) } },
      },
    ]);
    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(DartsGamePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({
      'GET /jatekok/darts/games/g1': reply instanceof Failure ? reply : { data: { game: reply } },
    });
    fixture.detectChanges();
  }

  /** Answers the next request with a game, and lets the page take it in. */
  async function answer(url: string, method: string, next: DartsGame) {
    await settle();
    const req = http.expectOne((r) => r.url === url && r.method === method);
    req.flush({ data: { game: next } });
    await settle();
    fixture.detectChanges();
    return req;
  }

  it('shows an X01 game: who is next and the number pad', () => {
    open();
    expect(page.name()).toBe('301');
    expect(page.isCricket()).toBe(false);
    expect(page.playing()).toBe(true);
    expect(page.current()?.name).toBe('Anna');
    expect(page.numbers()).toHaveLength(20);
    expect(page.cols()).toBe(2);
    expect(page.colsWide()).toBe(2);
    expect(page.slots()).toEqual([null, null, null]);
    expect(page.turnTotal()).toBe('0');
    expect(page.checkout()).toBeNull();
    expect(page.color(0)).toBe('var(--logo-orange)');
    expect(page.color(7)).toBe('var(--logo-orange)'); // the colours repeat
  });

  it('says so when the game cannot be loaded', () => {
    open(fail(404));
    expect(page.loadFailed()).toBe(true);
    expect(page.name()).toBe('');
    expect(page.current()).toBeNull();
    expect(page.ranking()).toEqual([]);
    expect(page.closedByAll(20)).toBe(false);
    page.rematch();
    void page.finish();
    http.expectNone((r) => r.method !== 'GET');
  });

  it('throws a dart with the chosen multiplier, which then falls back to single', async () => {
    open();
    page.multiplier.set(3);
    page.hit(20);
    expect(page.multiplier()).toBe(1);
    const after = game({
      turns: [turn(0, [[20, 3]])],
      next: { playerIdx: 0, round: 1, dartsLeft: 2, checkout: [{ segment: 20, multiplier: 2 }] },
    });
    const req = await answer(`${games}/g1/throws`, 'POST', after);
    expect(req.request.body).toEqual({ segment: 20, multiplier: 3 });
    expect(page.slots()).toEqual(['T20', null, null]);
    expect(page.turnTotal()).toBe('60');
    expect(page.checkout()).toBe('D20');
    expect(page.announcement()).toBeNull(); // still the same player
  });

  it('records a miss as a zero', async () => {
    open();
    page.multiplier.set(2);
    page.hit(0);
    await settle();
    expect(http.expectOne(`${games}/g1/throws`).request.body).toEqual({
      segment: 0,
      multiplier: 0,
    });
  });

  it('announces the next player, a bust, and someone checking out', async () => {
    vi.useFakeTimers();
    open();
    const next1 = { playerIdx: 1, round: 1, dartsLeft: 3, checkout: null };

    page.hit(5);
    await answer(`${games}/g1/throws`, 'POST', game({ turns: [turn(0, [[5, 1]])], next: next1 }));
    expect(page.announcement()).toEqual({ kind: 'next', title: 'Béla', sub: 'következik' });
    vi.advanceTimersByTime(1600);
    expect(page.announcement()).toBeNull();

    page.hit(20);
    await answer(
      `${games}/g1/throws`,
      'POST',
      game({
        turns: [turn(1, [[20, 1]], { bust: true })],
        next: { playerIdx: 0, round: 2, dartsLeft: 3, checkout: null },
      }),
    );
    expect(page.announcement()).toEqual({
      kind: 'bust',
      title: 'Besokallt! 💥',
      sub: 'Következik: Anna',
    });

    page.hit(20);
    await answer(
      `${games}/g1/throws`,
      'POST',
      game({ turns: [turn(0, [[20, 1]], { finished: true })], next: next1 }),
    );
    expect(page.announcement()?.title).toBe('Anna kiszállt! 🎯');

    page.hit(20);
    await answer(
      `${games}/g1/throws`,
      'POST',
      game({ status: 'finished', next: null, turns: [turn(1, [[20, 1]], { finished: true })] }),
    );
    expect(page.announcement()).toBeNull(); // the podium takes over
    expect(page.playing()).toBe(false);
  });

  it('takes back the last dart', async () => {
    open(
      game({
        turns: [turn(0, [[20, 1]])],
        next: { playerIdx: 0, round: 1, dartsLeft: 2, checkout: null },
      }),
    );
    page.undo();
    await answer(`${games}/g1/throws/last`, 'DELETE', game());
    expect(page.slots()).toEqual([null, null, null]);
  });

  it('reports a request that failed, and carries on', async () => {
    open();
    page.hit(20);
    await settle();
    http
      .expectOne(`${games}/g1/throws`)
      .flush({ message: 'A játék véget ért.' }, { status: 400, statusText: 'x' });
    await settle();
    expect(error).toHaveBeenCalledWith('A játék véget ért.');
    page.hit(19);
    await settle();
    http.expectOne(`${games}/g1/throws`);
  });

  it('lists the turns newest first, with what they were worth', () => {
    open(
      game({
        turns: [
          turn(0, [
            [20, 3],
            [5, 1],
            [0, 0],
          ]),
          turn(1, [[25, 2]], { bust: true }),
        ],
      }),
    );
    expect(page.history().map((h) => [h.turnIdx, h.name, h.darts, h.worth])).toEqual([
      [1, 'Béla', 'Bull', '50'],
      [0, 'Anna', 'T20 · 5 · –', '65'],
    ]);
  });

  describe('correcting an earlier turn', () => {
    const played = () =>
      game({
        turns: [
          turn(0, [
            [20, 1],
            [5, 1],
          ]),
          turn(1, [[19, 1]]),
        ],
        players: [
          player(0, 'Anna', { position: 1 }),
          player(1, 'Béla', { position: 2, userId: null }),
        ],
        next: { playerIdx: 0, round: 2, dartsLeft: 3, checkout: null },
      });

    it('edits the darts of the turn in place', () => {
      vi.useFakeTimers();
      open(played());
      page.historyOpen.set(true);
      page.startEdit(0);
      vi.advanceTimersByTime(1);
      expect(page.historyOpen()).toBe(false);
      expect(page.editedTurn()?.name).toBe('Anna');
      expect(page.slots()).toEqual(['20', '5', null]);
      expect(page.checkout()).toBeNull();

      page.selectSlot(1);
      page.multiplier.set(2);
      page.hit(16);
      expect(page.slots()).toEqual(['20', 'D16', null]);
      page.selectSlot(5); // no such slot
      page.selectSlot(2);
      page.hit(1);
      expect(page.turnTotal()).toBe('53');
      page.undo();
      page.undo();
      expect(page.slots()).toEqual(['20', null, null]);
      expect(page.editing()?.selected).toBe(1);
      http.expectNone((r) => r.method !== 'GET'); // nothing is sent until it is saved

      page.cancelEdit();
      expect(page.editing()).toBeNull();
    });

    it('cannot edit a game that is read-only, or a turn that does not exist', () => {
      open({ ...played(), canEdit: false });
      page.startEdit(0);
      expect(page.editing()).toBeNull();
      TestBed.resetTestingModule();
      open(played());
      page.startEdit(9);
      expect(page.editing()).toBeNull();
    });

    it('saves at once when the places stay the same', async () => {
      open(played());
      page.startEdit(0);
      const saving = page.saveEdit();
      await settle();
      const preview = http.expectOne((r) => r.url === `${games}/g1/turns/0`);
      expect(preview.request.params.get('preview')).toBe('true');
      preview.flush({ data: { game: played() } });
      await saving;
      expect(page.editing()).toBeNull();
      await answer(`${games}/g1/turns/0`, 'PATCH', played());
    });

    it('asks first when the correction changes the places', async () => {
      open(played());
      const confirm = TestBed.inject(ConfirmService);
      const swapped = {
        ...played(),
        players: [player(0, 'Anna', { position: 2 }), player(1, 'Béla', { position: null })],
      };

      page.startEdit(0);
      let saving = page.saveEdit();
      await settle();
      http.expectOne((r) => r.url === `${games}/g1/turns/0`).flush({ data: { game: swapped } });
      await settle();
      expect(confirm.pending()?.message).toBe(
        'Anna: 1. hely → 2. hely · Béla: 2. hely → nincs helyezés',
      );
      confirm.answer(false);
      await saving;
      expect(page.editing()).not.toBeNull(); // still editing
      http.expectNone((r) => r.method === 'PATCH');

      saving = page.saveEdit();
      await settle();
      http.expectOne((r) => r.url === `${games}/g1/turns/0`).flush({ data: { game: swapped } });
      await settle();
      confirm.answer(true);
      await saving;
      await answer(`${games}/g1/turns/0`, 'PATCH', swapped);
      expect(page.game()?.players[0].position).toBe(2);
    });

    it('refuses a correction the server cannot accept, and an empty one', async () => {
      open(played());
      page.startEdit(0);
      const saving = page.saveEdit();
      await settle();
      http
        .expectOne((r) => r.url === `${games}/g1/turns/0`)
        .flush({ message: 'Ezzel besokallna.' }, { status: 400, statusText: 'x' });
      await saving;
      expect(error).toHaveBeenCalledWith('Ezzel besokallna.');
      expect(page.editing()).not.toBeNull();

      page.undo();
      page.undo();
      await page.saveEdit(); // no darts left in it
      http.expectNone((r) => r.url === `${games}/g1/turns/0`);
    });
  });

  describe('ending the game', () => {
    it('abandons a game whose first round is not over, after a yes', async () => {
      open(game({ turns: [turn(0, [[20, 1]])] }));
      const confirm = TestBed.inject(ConfirmService);
      const asking = page.finish();
      expect(confirm.pending()?.title).toBe('Abbahagyjátok?');
      confirm.answer(true);
      await asking;
      await answer(`${games}/g1/abandon`, 'POST', game({ status: 'abandoned', next: null }));
      expect(page.playing()).toBe(false);
    });

    it('finishes a longer game at the present standing, after a yes', async () => {
      vi.useFakeTimers();
      open(game({ turns: [turn(0, [[20, 1]]), turn(1, [[19, 1]])] }));
      const confirm = TestBed.inject(ConfirmService);
      let asking = page.finish();
      expect(confirm.pending()?.title).toBe('Befejezitek a játékot?');
      confirm.answer(false);
      await asking;
      http.expectNone((r) => r.method === 'POST');

      asking = page.finish();
      confirm.answer(true);
      await asking;
      await answer(
        `${games}/g1/finish`,
        'POST',
        game({
          status: 'finished',
          next: null,
          placings: [1, 0],
          players: [
            player(0, 'Anna', { position: 2 }),
            player(1, 'Béla', { position: 1, userId: null }),
          ],
        }),
      );
      vi.advanceTimersByTime(1);
      expect(page.ranking().map((p) => p.name)).toEqual(['Béla', 'Anna']);
      expect(page.winners()).toEqual([
        { place: 2, userId: 'u0', name: 'Anna', photoVersion: null },
        { place: 1, userId: '', name: 'Béla', photoVersion: null },
      ]);
      expect(page.medal(1)).toBe('🥇');
      expect(page.medal(4)).toBe('4.');
    });

    it('starts a rematch with the same players and rules', async () => {
      open();
      page.rematch();
      const req = http.expectOne((r) => r.url === games && r.method === 'POST');
      expect(req.request.body).toEqual({
        type: 'x01',
        startScore: 301,
        outMode: 'single',
        players: [{ userId: 'u0' }, { guestName: 'Béla' }],
      });
      req.flush({ data: { game: game({ _id: 'g2' }) } });
      await settle();
      expect(navigate).toHaveBeenCalledWith(['/moka/darts', 'g2']);

      page.rematch();
      respond({ 'POST /jatekok/darts/games': fail() });
      expect(error).toHaveBeenCalledWith('Nem sikerült elindítani a visszavágót.');
    });
  });

  it('shows a Cricket game: the targets, the marks and what the turn was worth', () => {
    open(
      game({
        type: 'cricket',
        players: [
          player(0, 'Anna', { marks: { 20: 3, 19: 1 } }),
          player(1, 'Béla', { marks: { 20: 5 } }),
        ],
        turns: [
          turn(0, [[20, 3]], { marks: 3, points: 0 }),
          turn(
            1,
            [
              [20, 3],
              [20, 2],
            ],
            { marks: 3, points: 40 },
          ),
        ],
        next: { playerIdx: 1, round: 1, dartsLeft: 1, checkout: null },
      }),
    );
    expect(page.isCricket()).toBe(true);
    expect(page.name()).toBe('Cricket');
    expect(page.numbers()).toEqual([20, 19, 18, 17, 16, 15]);
    expect(page.turnTotal()).toBe('3✕ +40');
    expect(page.closedByAll(20)).toBe(true);
    expect(page.closedByAll(19)).toBe(false);
    expect([0, 1, 2, 3, 7, undefined].map((n) => page.mark(n))).toEqual([
      '',
      '╱',
      '✕',
      '⊗',
      '⊗',
      '',
    ]);
    expect(page.history().map((h) => h.worth)).toEqual(['3✕ +40', '3✕']);
    page.startEdit(0);
    expect(page.turnTotal()).toBe(''); // no running total while correcting in Cricket
  });

  it('keeps the screen awake while the page is visible', async () => {
    const release = vi.fn();
    const request = vi.fn().mockResolvedValue({ release });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    open();
    await settle();
    expect(request).toHaveBeenCalledWith('screen');
    fixture.destroy();
    expect(release).toHaveBeenCalled();
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });
});

describe('DartsSetup', () => {
  let fixture: ComponentFixture<DartsSetup>;
  let setup: DartsSetup;
  let navigate: ReturnType<typeof vi.spyOn>;

  const PEOPLE = [
    { _id: 'me', name: 'Teszt Elek', photoUpdatedAt: null },
    { _id: 'u1', name: 'Árvai Anna', photoUpdatedAt: null },
    { _id: 'u2', name: 'Kovács Béla', photoUpdatedAt: null },
  ];

  function open(reply: object = { data: { players: PEOPLE } }) {
    setUp();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    logIn({ id: 'me', role: 'admin' });
    fixture = TestBed.createComponent(DartsSetup);
    setup = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /jatekok/players': reply });
    fixture.detectChanges();
  }

  it('puts me in the game to begin with', () => {
    open();
    expect(setup.chosen().map((c) => c.name)).toEqual(['Teszt Elek']);
    expect(setup.available().map((p) => p._id)).toEqual(['u1', 'u2']);
  });

  it('reports players that cannot be loaded', () => {
    open(fail());
    expect(error).toHaveBeenCalledWith('Nem sikerült betölteni a játékosokat.');
    expect(setup.chosen()).toEqual([]);
    setup.start(); // nobody to play with
    http.expectNone((r) => r.method === 'POST');
  });

  it('adds members and guests, searches among those not yet chosen, and removes', () => {
    open();
    setup.search.set('ÁRVAI');
    expect(setup.available().map((p) => p._id)).toEqual(['u1']);
    setup.add(PEOPLE[1]);
    expect(setup.search()).toBe('');
    expect(setup.available().map((p) => p._id)).toEqual(['u2']);

    setup.guestName.set('  ');
    setup.addGuest();
    setup.guestName.set(' Vendég Vera ');
    setup.addGuest();
    expect(setup.chosen().map((c) => [c.name, c.userId])).toEqual([
      ['Teszt Elek', 'me'],
      ['Árvai Anna', 'u1'],
      ['Vendég Vera', null],
    ]);
    expect(setup.guestName()).toBe('');

    setup.remove('u1');
    expect(setup.chosen()).toHaveLength(2);
  });

  it('takes sixteen players at most', () => {
    open();
    for (let i = 0; i < 20; i++) {
      setup.guestName.set(`Vendég ${i}`);
      setup.addGuest();
    }
    expect(setup.chosen()).toHaveLength(16);
    expect(setup.isFull()).toBe(true);
    setup.add(PEOPLE[1]);
    expect(setup.chosen()).toHaveLength(16);
  });

  it('reorders by dragging and shuffles the throwing order', () => {
    open();
    setup.add(PEOPLE[1]);
    setup.add(PEOPLE[2]);
    setup.reorder({ previousIndex: 0, currentIndex: 2 } as Parameters<DartsSetup['reorder']>[0]);
    expect(setup.chosen().map((c) => c.key)).toEqual(['u1', 'u2', 'me']);
    setup.shuffle();
    expect(
      setup
        .chosen()
        .map((c) => c.key)
        .sort(),
    ).toEqual(['me', 'u1', 'u2']);
  });

  it('shows the rules of the chosen game and the hint of the checkout mode', () => {
    open();
    expect(setup.rules().title).toBe('301 (201, 101)');
    expect(setup.outHint()).toContain('Bármelyik mezővel');
    setup.type.set('cricket');
    setup.outMode.set('double');
    expect(setup.rules().title).toBe('Cricket');
    expect(setup.outHint()).toContain('Csak duplával');
  });

  it('starts the game and opens it', () => {
    open();
    setup.guestName.set('Vendég Vera');
    setup.addGuest();
    setup.startScore.set(201);
    setup.start();
    setup.start(); // already starting
    const req = http.expectOne(games);
    expect(req.request.body).toEqual({
      type: 'x01',
      startScore: 201,
      outMode: 'single',
      players: [{ userId: 'me' }, { guestName: 'Vendég Vera' }],
    });
    req.flush({ data: { game: game({ _id: 'g7' }) } });
    expect(navigate).toHaveBeenCalledWith(['/moka/darts', 'g7']);
  });

  it('reports a game that could not be started', () => {
    open();
    setup.start();
    respond({ 'POST /jatekok/darts/games': fail(400, 'Túl sok játékos.') });
    expect(error).toHaveBeenCalledWith('Túl sok játékos.');
    expect(setup.starting()).toBe(false);
  });
});

describe('DartsHome', () => {
  let fixture: ComponentFixture<DartsHome>;
  let home: DartsHome;

  function open(gamesReply: object, leadersReply: object) {
    setUp();
    logIn({ id: 'me', role: 'admin' });
    fixture = TestBed.createComponent(DartsHome);
    home = fixture.componentInstance;
    fixture.detectChanges();
    respond({
      'GET /jatekok/darts/games': gamesReply,
      'GET /jatekok/darts/leaderboard': leadersReply,
    });
    fixture.detectChanges();
  }

  it('lists the games and the 301 leaderboard', () => {
    open({ data: { games: [game()] } }, { data: { players: [{ userId: 'u1', name: 'Anna' }] } });
    expect(home.myId).toBe('me');
    expect(home.games()).toHaveLength(1);
    expect(home.leaders()).toHaveLength(1);
    expect(home.board().label).toBe('301');
  });

  it('switches the leaderboard, ignoring a late answer for the previous one', () => {
    open({ data: { games: [] } }, { data: { players: [] } });
    home.showBoard(home.boards[1]);
    home.showBoard(home.boards[3]);
    const [late, current] = http.match((r) => r.url.endsWith('/leaderboard'));
    expect(current.request.params.get('type')).toBe('cricket');
    current.flush({ data: { players: [{ userId: 'c' }] } });
    late.flush({ data: { players: [{ userId: 'late' }] } });
    expect(home.leaders()).toEqual([{ userId: 'c' }]);
  });

  it('shows empty lists when they cannot be loaded', () => {
    open(fail(), fail());
    expect(home.games()).toEqual([]);
    expect(home.leaders()).toEqual([]);
  });

  it('sums up where a game stands', () => {
    open({ data: { games: [] } }, { data: { players: [] } });
    const x01 = game({
      placings: [1],
      players: [
        player(0, 'Anna', { remaining: 120 }),
        player(1, 'Béla'),
        player(2, 'Cili', { remaining: 40 }),
      ],
    });
    expect(home.standing(x01)).toBe('🥇 Béla · Anna (120) · Cili (40)');
    const cricket = game({
      type: 'cricket',
      placings: [0, 1, 2, 3],
      players: ['A', 'B', 'C', 'D', 'E'].map((n, i) => player(i, n, { points: i * 10 })),
    });
    expect(home.standing(cricket)).toBe('🥇 A · 🥈 B · 🥉 C · 4. D · E (40)');
  });
});

describe('DartBoard', () => {
  it('draws the twenty sectors in board order', () => {
    setUp();
    const fixture = TestBed.createComponent(DartBoard);
    fixture.detectChanges();
    const { sectors } = fixture.componentInstance;
    expect(sectors).toHaveLength(20);
    expect(sectors.slice(0, 4).map((s) => s.value)).toEqual([20, 1, 18, 4]);
    expect(sectors[0]).toMatchObject({ even: true, delay: '0ms', x: '0.00', y: '-196.00' });
    expect(sectors[0].double).toMatch(/^M-?[\d.]+ -?[\d.]+ A172 172/);
  });
});

describe('Moka', () => {
  async function open(url: string, role: string) {
    setUp();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue(url);
    logIn({ role });
    const fixture = TestBed.createComponent(Moka);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('offers the card page of the running race to admins only', async () => {
    const member = await open('/moka', 'member');
    expect(member.futokorPages().map((p) => p.label)).not.toContain('Kártyák');
    expect(member.inFutokor()).toBe(false);
    expect(member.inGame()).toBe(false);
    TestBed.resetTestingModule();
    const admin = await open('/moka/futokor/futas', 'admin');
    expect(admin.futokorPages().at(-1)?.label).toBe('Kártyák');
    expect(admin.inFutokor()).toBe(true);
  });

  it('knows when a darts game is on screen (not the "new game" page)', async () => {
    expect((await open('/moka/darts/abc123', 'admin')).inGame()).toBe(true);
    TestBed.resetTestingModule();
    expect((await open('/moka/darts/uj', 'admin')).inGame()).toBe(false);
    TestBed.resetTestingModule();
    expect((await open('/moka/darts', 'admin')).inGame()).toBe(false);
  });
});
