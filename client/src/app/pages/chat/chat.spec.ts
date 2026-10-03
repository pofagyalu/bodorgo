import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';

import { API } from '../../../testing/http';
import { FakeSocket, fail, logIn, pageTesting, respond } from '../../../testing/component';
import { makeTour } from '../../../testing/fixtures';
import { NotificationsService } from '../../notifications/notifications.service';
import { ChatOverview, ChatRoomSummary } from '../../services/chat';
import { RoomBoardPerson, Tour } from '../../services/tour';
import { TourSocketService } from '../../services/tour-socket';
import { Chat } from './chat';
import { ChatList } from './chat-list/chat-list';
import { RoomBoard } from './room-board/room-board';

const Y = new Date().getFullYear();

const summary = (over: Partial<ChatRoomSummary> = {}): ChatRoomSummary => ({
  chatRoomId: 'r',
  lastPost: null,
  unread: 0,
  memberCount: 5,
  ...over,
});
const lastPost = (over = {}) => ({
  author: 'Kata',
  text: 'Sziasztok',
  hasImage: false,
  isPoll: false,
  createdAt: new Date().toISOString(),
  ...over,
});

const NEXT = makeTour({
  _id: 'next',
  order: 13,
  title: 'Bükk',
  startDate: `${Y + 1}-07-10T08:00:00`,
});
const LATER = makeTour({
  _id: 'later',
  order: 14,
  title: 'Zemplén',
  startDate: `${Y + 1}-09-01T08:00:00`,
});
const OLD = makeTour({ _id: 'old', order: 10, title: 'Mátra', startDate: '2022-07-10T08:00:00' });
const SILENT = makeTour({
  _id: 'silent',
  order: 9,
  title: 'Őrség',
  startDate: '2021-07-10T08:00:00',
});
const ELEVEN = makeTour({
  _id: 'eleven',
  order: 11,
  title: 'Balaton',
  startDate: '2023-07-10T08:00:00',
});
const TOURS = [OLD, NEXT, SILENT, LATER, ELEVEN];

const OVERVIEW: ChatOverview = {
  general: summary({ unread: 2, memberCount: 40, lastPost: lastPost() }),
  tours: [
    { ...summary({ unread: 3 }), tourId: 'next', past: false, closed: false },
    { ...summary(), tourId: 'later', past: false, closed: false },
    { ...summary({ lastPost: lastPost() }), tourId: 'old', past: true, closed: true },
    { ...summary(), tourId: 'silent', past: true, closed: true },
    { ...summary(), tourId: 'eleven', past: true, closed: false },
  ],
};

let success: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

function setUp(query: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    providers: [
      pageTesting(),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
    ],
  });
  const notifications = TestBed.inject(NotificationsService);
  success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
  error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe('Chat', () => {
  let fixture: ComponentFixture<Chat>;
  let page: Chat;
  let socket: FakeSocket;

  const routes = (): Record<string, object> => ({
    'GET /chat-rooms/overview': { data: OVERVIEW },
    'GET /chat-rooms/general/game': { data: { game: null } },
    'GET /tours': { data: { tours: TOURS } },
    'GET /chat-rooms/general': { data: { chatRoom: { _id: 'room-g', type: 'general' } } },
    'GET /tours/next/chat-room': { data: { chatRoom: { _id: 'room-next', type: 'tour' } } },
    'GET /tours/old/chat-room': { data: { chatRoom: { _id: 'room-old', type: 'tour' } } },
    'GET /push/chat-mutes/room-g': { data: { muted: true } },
    'GET /push/chat-mutes/room-next': { data: { muted: false } },
    'GET /chat-rooms/general/people': { data: { people: [] } },
    'GET /tours/next/rooms': { data: { houses: [], finalized: false, people: [] } },
    'GET /tours/old/rooms': { data: { houses: [], finalized: false, people: [] } },
    'GET /tours/next/chat/background': { data: { background: { version: 'v1' } } },
    'GET /tours/old/chat/background': { data: { background: null } },
  });

  /** Answers what is asked for, and lets the page react, until it is quiet. */
  function settleRequests(over: Record<string, object> = {}) {
    for (let i = 0; i < 4; i++) {
      respond({ ...routes(), ...over });
      fixture.detectChanges();
    }
  }

  function open(query: Record<string, string> = {}, phone = false, over = {}) {
    setUp(query);
    if (phone) {
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as MediaQueryList);
    }
    logIn({ id: 'me', role: 'admin' });
    socket = TestBed.inject(TourSocketService) as unknown as FakeSocket;
    fixture = TestBed.createComponent(Chat);
    page = fixture.componentInstance;
    fixture.detectChanges();
    settleRequests(over);
  }

  it('opens on the general room', () => {
    open();
    expect(page.loaded()).toBe(true);
    expect(page.isGeneral()).toBe(true);
    expect(page.chatRoomId()).toBe('room-g');
    expect(page.roomTitle()).toBe('Bódorgók');
    expect(page.roomPeople()).toBe('40 tag');
    expect(page.chatMuted()).toBe(true);
    expect(page.readOnly()).toBe(false);
    expect(page.feedKey()).toEqual([{ chatRoomId: 'room-g', tourId: null }]);
    expect(socket.leaveTour).toHaveBeenCalled();
  });

  it('sorts the tours newest first and files the finished ones away', () => {
    open();
    expect(page.allTours().map((t) => t._id)).toEqual(['later', 'next', 'eleven', 'old', 'silent']);
    expect(page.visibleTours().map((t) => t._id)).toEqual(['later', 'next']);
    // a finished tour stays listed only if somebody wrote in it - or it's the 11th
    expect(page.archivedTours().map((t) => t._id)).toEqual(['eleven', 'old']);
  });

  it('opens straight on the tour named in the address', () => {
    open({ tabor: 'next' });
    expect(page.selected()).toBe('next');
    expect(page.selectedTour()?.title).toBe('Bükk');
    expect(page.chatRoomId()).toBe('room-next');
    expect(page.roomTitle()).toBe('13. Bükk');
    expect(page.roomPeople()).toBe('5 résztvevő');
    expect(socket.joinTour).toHaveBeenCalledWith('next');
    expect(page.coverUrl(NEXT)).toBeNull();
    expect(page.formatDate(NEXT)).toBe(`${Y + 1}. júl. 10.`);
  });

  it("makes a finished tour's chat read-only, except the 11th", () => {
    open({ tabor: 'old' });
    expect(page.readOnly()).toBe(true);
    page.selectTour('eleven');
    expect(page.readOnly()).toBe(false);
  });

  it('counts unread messages, but not in the room that is on screen', () => {
    open();
    expect(page.unreadOf('general')).toBe(0); // I'm reading it
    expect(page.unreadOf('next')).toBe(3);
    expect(page.unreadOf('unknown')).toBe(0);
  });

  it('switches rooms and reloads the overview shortly after', () => {
    open();
    vi.useFakeTimers();
    page.selectTour('next');
    settleRequests();
    expect(page.chatRoomId()).toBe('room-next');
    expect(page.activePane()).toBe('chat');
    vi.advanceTimersByTime(600);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${API}/chat-rooms/overview`).flush({ data: OVERVIEW });

    page.selectGeneral();
    settleRequests();
    expect(page.isGeneral()).toBe(true);
    page.selectFromList('general'); // the same room again: nothing to refresh
    vi.advanceTimersByTime(60_000); // the regular refresh
    expect(http.match(`${API}/chat-rooms/overview`).length).toBeGreaterThan(0);
  });

  it('reloads the overview when the page becomes visible again', () => {
    open();
    document.dispatchEvent(new Event('visibilitychange'));
    TestBed.inject(HttpTestingController).expectOne(`${API}/chat-rooms/overview`);
  });

  it('mutes and unmutes the room, undoing the switch if the save fails', () => {
    open();
    page.toggleChatMuted();
    expect(page.chatMuted()).toBe(false);
    respond({ 'PUT /push/chat-mutes/room-g': { data: { muted: false } } });
    expect(success).toHaveBeenCalledWith('Értesítések ebből a Kotyogóból bekapcsolva.');

    page.toggleChatMuted();
    respond({ 'PUT /push/chat-mutes/room-g': { data: { muted: true } } });
    expect(success).toHaveBeenCalledWith('Ennek a Kotyogónak az értesítései némítva.');

    page.toggleChatMuted();
    respond({ 'PUT /push/chat-mutes/room-g': fail() });
    expect(page.chatMuted()).toBe(true);
    expect(error).toHaveBeenCalledWith('Nem sikerült menteni.');
  });

  it('lets an admin switch the background of a tour chat', () => {
    open({ tabor: 'next' });
    expect(page.canSwitchBackground()).toBe(true);
    page.nextBackground();
    expect(page.switchingBackground()).toBe(true);
    respond({
      'POST /tours/next/chat/background/next': { data: { background: { version: 'v2' } } },
    });
    expect(page.switchingBackground()).toBe(false);
  });

  it('shows the podium of the general chat game and celebrates a new place', () => {
    open({}, false, {
      'GET /chat-rooms/general/game': {
        data: {
          game: {
            startedAt: 'x',
            finishedAt: null,
            places: 3,
            winners: [
              { place: 1, userId: 'u1', name: 'Teszt Kata', username: 'kato', photoUpdatedAt: 'v' },
            ],
          },
        },
      },
    });
    expect(page.podiumWinners()).toEqual([
      { place: 1, userId: 'u1', name: 'kato', photoVersion: 'v' },
    ]);
    vi.useFakeTimers();
    socket.fire('chat-game', { game: null, newPlace: 2 });
    expect(page.game()).toBeNull();
    vi.advanceTimersByTime(10);
    fixture.destroy();
    expect(socket.handlers.get('chat-game')).toEqual([]);
  });

  it('plays a sample podium for ?dobogo=proba', () => {
    vi.useFakeTimers();
    open({ dobogo: 'proba' });
    expect(page.game()?.winners).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(page.podiumWinners().map((w) => w.name)).toEqual(['Próba Panni']);
    vi.advanceTimersByTime(14_000);
    expect(page.podiumWinners()).toHaveLength(3);
    expect(page.game()?.finishedAt).not.toBeNull();
  });

  it('still opens when the tours cannot be loaded', () => {
    open({}, false, { 'GET /tours': fail(), 'GET /chat-rooms/overview': fail() });
    expect(page.loaded()).toBe(true);
    expect(page.selected()).toBeNull();
    expect(page.roomPeople()).toBe('');
    page.toggleChatMuted(); // no room - nothing to mute
  });

  describe('on a phone', () => {
    it('shows the list first, then the picked room, and Back returns to the list', () => {
      open({}, true);
      expect(page.roomOnScreen()).toBe(false);
      expect(page.feedKey()).toEqual([]);
      expect(page.unreadOf('general')).toBe(2); // not on screen: still unread

      const push = vi.spyOn(history, 'pushState');
      page.selectFromList('next');
      settleRequests();
      expect(page.roomOnScreen()).toBe(true);
      expect(push).toHaveBeenCalledTimes(1);

      vi.useFakeTimers();
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(page.listOnPhone()).toBe(true);
      window.dispatchEvent(new PopStateEvent('popstate')); // nothing of ours left in history
      page.backToList();
      expect(page.listOnPhone()).toBe(true);
    });

    it('goes back through the history when the room was opened from the list', () => {
      open({}, true);
      const back = vi.spyOn(history, 'back').mockImplementation(() => {});
      page.selectFromList('next');
      page.backToList();
      expect(back).toHaveBeenCalled();
    });

    it('opens the room at once when the address asks for the chat', () => {
      open({ kotyogo: '1' }, true);
      expect(page.roomOnScreen()).toBe(true);
    });
  });

  describe('the width of the room board', () => {
    it('starts from the remembered width', () => {
      localStorage.setItem('bodorgo.chat.roomsWidth', '450');
      open({ tabor: 'next' });
      expect(page.roomsWidth()).toBe(450);
      page.resetRoomsWidth();
      expect(page.roomsWidth()).toBe(380);
      expect(localStorage.getItem('bodorgo.chat.roomsWidth')).toBe('380');
    });

    it('ignores a remembered width that is too narrow', () => {
      localStorage.setItem('bodorgo.chat.roomsWidth', '100');
      open();
      expect(page.roomsWidth()).toBe(380);
    });

    it('follows the dragged divider within its limits, and remembers the result', () => {
      open({ tabor: 'next' });
      const panes = (page as unknown as { panes: () => { nativeElement: HTMLElement } }).panes();
      if (!panes) return; // the divider is only there in the two-pane layout
      vi.spyOn(panes.nativeElement, 'getBoundingClientRect').mockReturnValue({
        right: 1200,
        width: 1200,
      } as DOMRect);
      page.startResize({ preventDefault: () => {} } as PointerEvent);
      expect(page.resizing()).toBe(true);
      const move = (clientX: number) =>
        window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX }));
      move(700);
      expect(page.roomsWidth()).toBe(500);
      move(1190);
      expect(page.roomsWidth()).toBe(320); // not narrower than this
      move(0);
      expect(page.roomsWidth()).toBe(840); // the chat keeps its minimum
      window.dispatchEvent(new Event('pointerup'));
      expect(page.resizing()).toBe(false);
      expect(localStorage.getItem('bodorgo.chat.roomsWidth')).toBe('840');
    });
  });
});

describe('ChatList', () => {
  let fixture: ComponentFixture<ChatList>;
  let list: ChatList;

  beforeEach(() => {
    setUp();
    fixture = TestBed.createComponent(ChatList);
    list = fixture.componentInstance;
    fixture.componentRef.setInput('tours', TOURS);
    fixture.componentRef.setInput('overview', OVERVIEW);
    fixture.detectChanges();
  });

  it('lists the coming tours soonest first and the finished ones newest first', () => {
    expect(list.active().map((r) => r.key)).toEqual(['next', 'later']);
    // a finished tour nobody wrote in is left out once its chat is closed
    expect(list.archived().map((r) => r.key)).toEqual(['eleven', 'old']);
    expect(list.generalRow().summary?.unread).toBe(2);
    expect(list.showGeneral()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Bükk');
  });

  it('searches by title, number or year, ignoring accents', () => {
    list.search.set('bukk');
    expect(list.active().map((r) => r.key)).toEqual(['next']);
    expect(list.showGeneral()).toBe(false);
    list.search.set('2022');
    expect(list.archived().map((r) => r.key)).toEqual(['old']);
    list.search.set('14');
    expect(list.active().map((r) => r.key)).toEqual(['later']);
    list.search.set('nincs ilyen');
    expect(list.nothingFound()).toBe(true);
  });

  it('previews the last message of a room', () => {
    const row = (post: object | null) => ({
      ...list.generalRow(),
      summary: summary({ lastPost: post as never }),
    });
    expect(list.lastLine(row(null))).toBe('Még nincs üzenet');
    expect(list.lastLine(row(lastPost()))).toBe('Kata: Sziasztok');
    expect(list.lastLine(row(lastPost({ hasImage: true, text: '' })))).toBe('Kata: 📷 Fotó');
    expect(list.lastLine(row(lastPost({ isPoll: true, text: 'Hova?' })))).toBe('Kata: 📊 Hova?');
    expect(list.lastLine(row(lastPost({ isPoll: true, text: '' })))).toBe('Kata: 📊 Szavazás');
  });

  it('shows the time for today, the day for this year, the full date for older ones', () => {
    const row = (createdAt?: string) => ({
      ...list.generalRow(),
      summary: summary({ lastPost: createdAt ? lastPost({ createdAt }) : null }),
    });
    const now = new Date();
    expect(list.lastTime(row())).toBe('');
    expect(list.lastTime(row(now.toISOString()))).toMatch(/^\d{2}:\d{2}$/);
    expect(list.lastTime(row('2020-03-05T10:00:00'))).toBe('2020. 03. 05.');
    const otherDay = new Date(now.getFullYear(), now.getMonth() === 0 ? 1 : 0, 15, 12);
    expect(list.lastTime(row(otherDay.toISOString()))).toMatch(/\d+\.$/);
  });

  it('knows nothing about the rooms without an overview', () => {
    fixture.componentRef.setInput('overview', null);
    expect(list.generalRow().summary).toBeNull();
    expect(list.archived()).toEqual([]);
    expect(list.active()).toHaveLength(5);
  });
});

describe('RoomBoard', () => {
  let fixture: ComponentFixture<RoomBoard>;
  let board: RoomBoard;
  let socket: FakeSocket;
  let http: HttpTestingController;

  const person = (id: string, over: Partial<RoomBoardPerson> = {}): RoomBoardPerson => ({
    attendeeId: id,
    userId: id,
    name: `Ember ${id}`,
    username: null,
    photoUpdatedAt: null,
    familyId: null,
    roomId: null,
    ...over,
  });
  const HOUSES = [
    {
      _id: 'h1',
      name: 'Faház',
      description: '',
      rooms: [
        { _id: 'r1', name: 'Emelet', description: '', beds: 2 },
        { _id: 'r2', name: 'Földszint', description: '', beds: 3 },
      ],
    },
  ];
  const PEOPLE = [
    person('me', { familyId: 'f1', roomId: 'r1', username: 'elek' }),
    person('kid', { familyId: 'f1', name: 'Teszt Kata' }),
    person('b', { roomId: 'r1' }),
    person('z', { name: 'Zoli' }),
    person('a', { name: 'Anna' }),
  ];
  const boardReply = (over = {}) => ({
    data: { houses: HOUSES, finalized: false, people: PEOPLE, ...over },
  });

  function open(role = 'admin', tour: Tour = makeTour(), reply: object = boardReply()) {
    setUp();
    http = TestBed.inject(HttpTestingController);
    logIn({ id: 'me', role });
    socket = TestBed.inject(TourSocketService) as unknown as FakeSocket;
    fixture = TestBed.createComponent(RoomBoard);
    board = fixture.componentInstance;
    fixture.componentRef.setInput('tour', tour);
    fixture.detectChanges();
    respond({ 'GET /tours/t1/rooms': reply });
    fixture.detectChanges();
  }

  it('shows who sleeps where and who has no room yet', () => {
    open();
    expect(board.loaded()).toBe(true);
    expect(board.totalBeds()).toBe(5);
    expect(board.occupants('r1').map((p) => p.attendeeId)).toEqual(['me', 'b']);
    // the unassigned: families together, then by name
    expect(board.unassigned().map((p) => p.name)).toEqual(['Anna', 'Teszt Kata', 'Zoli']);
    expect(board.isFull(HOUSES[0].rooms[0])).toBe(true);
    expect(board.freePlaces(HOUSES[0].rooms[1])).toEqual([0, 1, 2]);
    expect(board.placeOf('r2')).toBe('Faház / Földszint');
    expect(board.placeOf('nope')).toBeNull();
    expect(board.placeOf(null)).toBeNull();
    expect(board.label(PEOPLE[0])).toBe('elek');
    expect(board.label(PEOPLE[1])).toBe('Teszt Kata');
  });

  it("tells me where my family's places are", () => {
    open('member');
    expect(board.myPlaces().map((p) => [p.person.attendeeId, p.where])).toEqual([
      ['me', 'Faház / Emelet'],
      ['kid', null],
    ]);
    expect(board.canEdit()).toBe(false);
  });

  it('has no places to tell someone who is not on the tour', () => {
    open('admin', makeTour(), boardReply({ people: [person('b')] }));
    expect(board.myPlaces()).toEqual([]);
  });

  it('is editable by an admin until it is finalized or the tour is closed', () => {
    open();
    expect(board.canEdit()).toBe(true);
    board.toggleFinalized();
    expect(board.busy()).toBe(true);
    const req = http.expectOne(`${API}/tours/t1/rooms/finalized`);
    expect(req.request.body).toEqual({ finalized: true });
    req.flush({});
    expect(board.canEdit()).toBe(false);
    expect(success).toHaveBeenCalledWith('Szobabeosztás véglegesítve');

    board.toggleFinalized();
    respond({ 'PUT /tours/t1/rooms/finalized': {} });
    expect(success).toHaveBeenCalledWith('Véglegesítés feloldva');
    board.toggleFinalized();
    respond({ 'PUT /tours/t1/rooms/finalized': fail(400, 'Még van szoba nélküli.') });
    expect(error).toHaveBeenCalledWith('Még van szoba nélküli.');
    expect(board.busy()).toBe(false);

    TestBed.resetTestingModule();
    open('admin', makeTour({ closed: true }));
    expect(board.isAdmin()).toBe(false);
  });

  it('moves a tapped person into the picked room', () => {
    open();
    board.onPersonTap(PEOPLE[3]);
    expect(board.picking()?.attendeeId).toBe('z');
    board.pick('r2');
    expect(board.picking()).toBeNull();
    expect(board.occupants('r2').map((p) => p.attendeeId)).toEqual(['z']); // shown at once
    const req = http.expectOne(`${API}/tours/t1/rooms/assignment`);
    expect(req.request.body).toEqual({ attendeeId: 'z', roomId: 'r2' });
    req.flush({});

    board.onPersonTap(PEOPLE[0]);
    board.pick('r1'); // already there: nothing to do
    http.expectNone(`${API}/tours/t1/rooms/assignment`);
  });

  it('puts the person back when the move is refused', () => {
    open();
    board.onPersonTap(PEOPLE[3]);
    board.pick('r1');
    respond({ 'PUT /tours/t1/rooms/assignment': fail(400, 'A szoba megtelt.') });
    expect(error).toHaveBeenCalledWith('A szoba megtelt.');
    respond({ 'GET /tours/t1/rooms': boardReply() });
    expect(board.occupants('r1').map((p) => p.attendeeId)).toEqual(['me', 'b']);
  });

  it('does not open the picker for a non-admin, or right after a drag', () => {
    open();
    vi.useFakeTimers();
    board.onDragStarted(PEOPLE[0]);
    board.onPersonTap(PEOPLE[0]); // the tap that ends the drag
    expect(board.picking()).toBeNull();
    board.onDragEnded();
    vi.advanceTimersByTime(1);

    TestBed.resetTestingModule();
    open('member');
    board.onPersonTap(PEOPLE[3]);
    expect(board.picking()).toBeNull();
  });

  it('moves a dragged person, and shows the bed being taken while hovering', () => {
    open();
    board.onDragStarted(PEOPLE[0]); // from r1
    board.onRoomEntered('r1'); // its own room: no change
    expect(board.hoverRoomId()).toBeNull();
    board.onRoomEntered('r2');
    expect(board.freePlaces(HOUSES[0].rooms[1])).toEqual([0, 1]);
    board.onRoomExited('r1');
    expect(board.hoverRoomId()).toBe('r2');
    board.onRoomExited('r2');
    expect(board.hoverRoomId()).toBeNull();
    board.onRoomEntered(undefined);

    const drop = (from: object, to: { data: string | null }) =>
      board.onDrop({
        previousContainer: from,
        container: to,
        item: { data: PEOPLE[0] },
      } as unknown as CdkDragDrop<unknown, unknown, RoomBoardPerson>);
    const r2 = { data: 'r2' };
    drop(r2, r2); // dropped where it came from
    http.expectNone(`${API}/tours/t1/rooms/assignment`);
    drop({ data: 'r1' }, { data: null }); // out to "no room yet"
    expect(http.expectOne(`${API}/tours/t1/rooms/assignment`).request.body).toEqual({
      attendeeId: 'me',
      roomId: null,
    });
  });

  it('accepts a drop only where there is a free bed', () => {
    open();
    const accepts = (p: RoomBoardPerson, roomId: string | null) =>
      board.roomAccepts(
        { data: p } as CdkDrag<RoomBoardPerson>,
        { data: roomId } as CdkDropList<string | null>,
      );
    expect(accepts(PEOPLE[3], 'r1')).toBe(false); // full
    expect(accepts(PEOPLE[0], 'r1')).toBe(true); // already in it
    expect(accepts(PEOPLE[3], 'r2')).toBe(true);
    expect(accepts(PEOPLE[0], null)).toBe(true); // the "no room yet" list
  });

  it('reloads when someone else changes the rooms of this tour', () => {
    open();
    socket.fire('rooms-changed', { tourId: 'other' });
    http.expectNone(`${API}/tours/t1/rooms`);
    socket.fire('rooms-changed', { tourId: 't1' });
    respond({ 'GET /tours/t1/rooms': boardReply({ finalized: true }) });
    expect(board.finalized()).toBe(true);
    fixture.destroy();
    expect(socket.handlers.get('rooms-changed')).toEqual([]);
  });

  it('counts as loaded even when the request fails', () => {
    open('admin', makeTour(), fail());
    expect(board.loaded()).toBe(true);
    expect(board.houses()).toEqual([]);
  });
});
