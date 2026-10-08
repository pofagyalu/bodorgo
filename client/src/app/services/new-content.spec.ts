import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { ChatOverview, ChatService } from './chat';
import { PollService } from './poll';
import { PushService } from './push';

// What tells a logged-in user that something new waits for them - the
// counts behind the menu's badges - and the phone's notifications being
// taken away once that something has been seen in the app.

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const room = (chatRoomId: string | null, unread: number) => ({
  chatRoomId,
  lastPost: null,
  unread,
  memberCount: 5,
});

const OVERVIEW: ChatOverview = {
  general: room('g', 2),
  tours: [
    { ...room('t1', 3), tourId: 'tour1', past: false, closed: false },
    { ...room('t2', 0), tourId: 'tour2', past: false, closed: false },
    { ...room(null, 0), tourId: 'tour3', past: false, closed: false },
  ],
};

describe('new content', () => {
  let http: HttpTestingController;
  let closed: ((tag: string) => boolean)[];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    http = TestBed.inject(HttpTestingController);
    closed = [];
    vi.spyOn(TestBed.inject(PushService), 'closeNotifications').mockImplementation(
      async (matches) => {
        closed.push(matches);
      },
    );
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('counts the unread messages of all my chats', () => {
    const chat = TestBed.inject(ChatService);
    expect(chat.unreadCount()).toBe(0);
    chat.refreshUnread();
    const req = http.expectOne(`${API}/chat-rooms/overview`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: OVERVIEW });
    expect(chat.unreadCount()).toBe(5);
  });

  it('takes the notifications of the chats with nothing unread off the phone', () => {
    const chat = TestBed.inject(ChatService);
    chat.getOverview().subscribe();
    http.expectOne(`${API}/chat-rooms/overview`).flush({ data: OVERVIEW });
    expect(closed).toHaveLength(1);
    expect(['chat-g', 'chat-t1', 'chat-t2', 'poll-1'].filter(closed[0])).toEqual(['chat-t2']);
  });

  it('leaves every notification alone while each chat has something unread', () => {
    const chat = TestBed.inject(ChatService);
    chat.refreshUnread();
    http
      .expectOne(`${API}/chat-rooms/overview`)
      .flush({ data: { general: room('g', 1), tours: [] } });
    expect(closed).toHaveLength(0);
  });

  it('keeps the count when the overview cannot be loaded', () => {
    const chat = TestBed.inject(ChatService);
    chat.unreadCount.set(4);
    chat.refreshUnread();
    http.expectOne(`${API}/chat-rooms/overview`).flush(null, { status: 500, statusText: 'Error' });
    expect(chat.unreadCount()).toBe(4);
  });

  it('takes the poll notifications off once no poll waits for my vote', () => {
    const polls = TestBed.inject(PollService);
    polls.refreshPending();
    http.expectOne(`${API}/polls/pending`).flush({ data: { count: 2 } });
    expect(polls.pendingCount()).toBe(2);
    expect(closed).toHaveLength(0);

    polls.refreshPending();
    http.expectOne(`${API}/polls/pending`).flush({ data: { count: 0 } });
    expect(closed).toHaveLength(1);
    expect(['poll-1', 'chat-g', 'test'].filter(closed[0])).toEqual(['poll-1']);
  });
});

describe('PushService.closeNotifications', () => {
  const shown = (tag: string) => ({ tag, close: vi.fn() });

  function browserWith(registration: unknown) {
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: 'granted' });
    const worker = { getRegistration: vi.fn(async () => registration), register: vi.fn() };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
    return worker;
  }

  beforeEach(() => TestBed.configureTestingModule({ providers: [httpTesting()] }));

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('closes the matching ones and leaves the rest', async () => {
    const list = [shown('chat-a'), shown('chat-b'), shown('poll-1')];
    const worker = browserWith({ getNotifications: async () => list });
    await TestBed.inject(PushService).closeNotifications((tag) => tag === 'chat-b');
    await settle();
    expect(list.map((n) => n.close.mock.calls.length)).toEqual([0, 1, 0]);
    // Looked up, never registered.
    expect(worker.getRegistration).toHaveBeenCalledWith('/');
    expect(worker.register).not.toHaveBeenCalled();
  });

  it('does nothing without a service worker, or without web push at all', async () => {
    const push = TestBed.inject(PushService);
    await expect(push.closeNotifications(() => true)).resolves.toBeUndefined();
    browserWith(undefined);
    await expect(push.closeNotifications(() => true)).resolves.toBeUndefined();
  });

  it('swallows a browser that refuses', async () => {
    browserWith({
      getNotifications: async () => {
        throw new Error('nem');
      },
    });
    await expect(
      TestBed.inject(PushService).closeNotifications(() => true),
    ).resolves.toBeUndefined();
  });
});
