// The services that sit on browser features jsdom doesn't have (web push,
// the socket, <audio>): each is tested against a small stand-in.
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { Mock } from 'vitest';

import { API, httpTesting } from '../../testing/http';
import { AuthService } from '../auth/auth.service';
import { MusicPlayerService, MusicTrack } from './music-player';
import { PushService } from './push';
import { TourSocketService } from './tour-socket';
import { CLIENT_BUILD, CLIENT_VERSION, VersionService } from './version';

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('PushService', () => {
  let service: PushService;
  let http: HttpTestingController;
  let subscription: {
    endpoint: string;
    toJSON: () => unknown;
    unsubscribe: ReturnType<typeof vi.fn>;
  } | null;
  let subscribe: Mock<(options?: { applicationServerKey: Uint8Array }) => Promise<unknown>>;
  const push = `${API}/push`;

  /** Gives the browser everything web push needs. */
  function supportPush(permission: NotificationPermission, asked = permission) {
    subscribe = vi.fn(async () => {
      subscription = {
        endpoint: 'https://push/1',
        toJSON: () => ({ endpoint: 'https://push/1' }),
        unsubscribe: vi.fn(),
      };
      return subscription;
    });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', {
      permission,
      requestPermission: vi.fn(async () => asked),
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn(async () => ({
          pushManager: { getSubscription: async () => subscription, subscribe },
        })),
      },
    });
  }

  beforeEach(() => {
    subscription = null;
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(PushService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('is unsupported in a browser without web push', async () => {
    expect(await service.refresh()).toBe('unsupported');
    expect(service.state()).toBe('unsupported');
  });

  it('asks an iPhone to install the app first', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone)');
    expect(service.isIos).toBe(true);
    expect(await service.refresh()).toBe('needs-install');
  });

  it('is denied when the user blocked notifications', async () => {
    supportPush('denied');
    expect(await service.refresh()).toBe('denied');
  });

  it('is off without a subscription and on with one', async () => {
    supportPush('granted');
    expect(await service.refresh()).toBe('off');
    await subscribe();
    expect(await service.refresh()).toBe('on');
  });

  it('subscribes this device and tells the server', async () => {
    supportPush('default', 'granted');
    const done = service.enable();
    http.expectOne(`${push}/public-key`).flush({ data: { publicKey: 'AQID-_8' } });
    await settle();
    const saved = http.expectOne(`${push}/subscriptions`);
    expect(saved.request.body).toEqual({ endpoint: 'https://push/1' });
    saved.flush({});
    await done;

    expect(service.state()).toBe('on');
    const key = subscribe.mock.calls[0][0]!.applicationServerKey;
    expect([...key]).toEqual([1, 2, 3, 251, 255]); // url-safe base64, unpadded
  });

  it('fails when the server has no push key', async () => {
    supportPush('default');
    const done = service.enable();
    http.expectOne(`${push}/public-key`).flush({ data: { publicKey: null } });
    await expect(done).rejects.toThrow('nincsenek beállítva');
  });

  it('fails when the user does not allow notifications', async () => {
    supportPush('default', 'denied');
    const done = service.enable();
    http.expectOne(`${push}/public-key`).flush({ data: { publicKey: 'AQID' } });
    await expect(done).rejects.toThrow('nincsenek engedélyezve');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes this device and tells the server', async () => {
    supportPush('granted');
    await subscribe();
    const unsubscribe = subscription!.unsubscribe;
    const done = service.disable();
    await settle();
    const req = http.expectOne(`${push}/subscriptions`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ endpoint: 'https://push/1' });
    req.flush({});
    await done;
    expect(unsubscribe).toHaveBeenCalled();
    expect(service.state()).toBe('off');
  });

  it('has nothing to tell the server when there was no subscription', async () => {
    supportPush('granted');
    await service.disable();
    expect(service.state()).toBe('off');
  });

  it('sends the test and the chat mute requests', () => {
    service.sendTest().subscribe();
    expect(http.expectOne(`${push}/test`).request.method).toBe('POST');
    service.getChatMuted('r1').subscribe();
    expect(http.expectOne(`${push}/chat-mutes/r1`).request.method).toBe('GET');
    service.setChatMuted('r1', true).subscribe();
    const put = http.expectOne(`${push}/chat-mutes/r1`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ muted: true });
  });
});

describe('TourSocketService', () => {
  let service: TourSocketService;
  let socket: {
    connected: boolean;
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = TestBed.inject(TourSocketService);
    socket = { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    // the real connection is never opened in a test
    (service as unknown as { socket: unknown }).socket = socket;
  });

  it('joins a tour once, and leaves the previous one when switching', () => {
    service.joinTour('t1');
    service.joinTour('t1');
    expect(socket.emit.mock.calls).toEqual([['join-tour', { tourId: 't1' }]]);

    service.joinTour('t2');
    expect(socket.emit.mock.calls.slice(1)).toEqual([
      ['leave-tour', { tourId: 't1' }],
      ['join-tour', { tourId: 't2' }],
    ]);

    service.leaveTour();
    expect(socket.emit).toHaveBeenLastCalledWith('leave-tour', { tourId: 't2' });
    socket.emit.mockClear();
    service.leaveTour(); // nothing joined any more
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('re-joins the same chat room (to mark it read again) and swaps rooms', () => {
    service.joinChat('r1');
    service.joinChat('r1');
    service.joinChat('r2');
    expect(socket.emit.mock.calls).toEqual([
      ['join-chat', { chatRoomId: 'r1' }],
      ['join-chat', { chatRoomId: 'r1' }],
      ['leave-chat', { chatRoomId: 'r1' }],
      ['join-chat', { chatRoomId: 'r2' }],
    ]);
  });

  it('leaves only the chat room it is in', () => {
    service.joinChat('r1');
    socket.emit.mockClear();
    service.leaveChat('other');
    expect(socket.emit).not.toHaveBeenCalled();
    service.leaveChat('r1');
    expect(socket.emit).toHaveBeenCalledWith('leave-chat', { chatRoomId: 'r1' });
  });

  it('sends nothing while disconnected, only remembers what to join', () => {
    socket.connected = false;
    service.joinTour('t1');
    service.joinChat('r1');
    service.leaveChat('r1');
    service.leaveTour();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('subscribes to an event and gives back the unsubscribe', () => {
    const handler = () => {};
    const off = service.on('post-created', handler);
    expect(socket.on).toHaveBeenCalledWith('post-created', handler);
    off();
    expect(socket.off).toHaveBeenCalledWith('post-created', handler);
  });

  it('emits an event', () => {
    service.emit('typing', { chatRoomId: 'r1' });
    expect(socket.emit).toHaveBeenCalledWith('typing', { chatRoomId: 'r1' });
  });
});

describe('VersionService', () => {
  let service: VersionService;
  let http: HttpTestingController;
  type Internals = { check(cameBack: boolean): Promise<void>; newerIsOut: boolean };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [httpTesting(), provideRouter([])] });
    service = TestBed.inject(VersionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('asks the server for its version', () => {
    service.getServerVersion().subscribe();
    expect(http.expectOne(`${API}/health/version`).request.method).toBe('GET');
  });

  it('is a development build in the tests, with nothing to watch', () => {
    expect(CLIENT_BUILD).toBeNull();
    expect(CLIENT_VERSION).toBe('fejlesztői');
    const listen = vi.spyOn(document, 'addEventListener');
    service.watchForNewVersion();
    expect(listen).not.toHaveBeenCalled();
  });

  it('does not count a failed or offline version check as a new version', async () => {
    const internals = service as unknown as Internals;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false })),
    );
    await internals.check(true);
    expect(internals.newerIsOut).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await internals.check(true);
    expect(internals.newerIsOut).toBe(false);
  });

  it('never reloads over something half-typed', async () => {
    const internals = service as unknown as Internals;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ version: '9.9.9' }) })),
    );
    document.body.innerHTML = '<textarea>félkész üzenet</textarea>';
    await internals.check(true);
    expect(internals.newerIsOut).toBe(true);

    document.body.innerHTML = '<input><div contenteditable="true">jegyzet</div>';
    await internals.check(true); // an editor with text also holds the reload back
  });
});

describe('MusicPlayerService', () => {
  let service: MusicPlayerService;
  let http: HttpTestingController;
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;
  const music = `${API}/music`;

  const track = (id: string, over: Partial<MusicTrack> = {}): MusicTrack => ({
    id,
    title: `Dal ${id}`,
    artist: 'Zenekar',
    durationMs: 180_000,
    streamUrl: `/music/stream/${id}`,
    imageUrl: null,
    ...over,
  });
  const audio = () => (service as unknown as { audio: HTMLAudioElement }).audio;

  /** Starts a playlist and answers its request. */
  async function start(tracks: MusicTrack[], key: 'bodorgo-fm' | 'buli' = 'bodorgo-fm') {
    const done = service.playPlaylist(key);
    http.expectOne(`${music}/${key}/playlist`).flush({ data: { tracks } });
    await done;
  }

  beforeEach(() => {
    localStorage.clear();
    // jsdom has the <audio> element but can't play: playing is just recorded
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('play'));
    });
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('pause'));
    });
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(MusicPlayerService);
    http = TestBed.inject(HttpTestingController);
    service.shuffle.set(false);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('starts quiet, or at the volume kept on this device', () => {
    expect(service.volume()).toBe(0.15);
    service.setVolume(0.6);
    expect(localStorage.getItem('bodorgo-music-volume')).toBe('0.6');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    expect(TestBed.inject(MusicPlayerService).volume()).toBe(0.6);
  });

  it('keeps the volume between 0 and 1, and zero counts as muted', () => {
    service.setVolume(3);
    expect(service.volume()).toBe(1);
    service.setVolume(-1);
    expect(service.volume()).toBe(0);
    expect(service.muted()).toBe(true);
    service.toggleMute();
    expect(service.muted()).toBe(false);
  });

  it('loads a playlist once and plays its first track', async () => {
    await start([track('a'), track('b')]);
    expect(service.tracks()).toHaveLength(2);
    expect(service.currentTrack()?.id).toBe('a');
    expect(audio().src).toBe(`${API}/music/stream/a`);
    expect(service.duration()).toBe(180);
    expect(service.isPlaying()).toBe(true);
    expect(service.loading()).toBe(false);

    expect(await service.loadPlaylist()).toBe(true); // from memory, no request
  });

  it('pauses and resumes with the same button', async () => {
    await start([track('a')]);
    await service.playPlaylist('bodorgo-fm');
    expect(pause).toHaveBeenCalled();
    expect(service.isPlaying()).toBe(false);
    await service.toggle();
    expect(service.isPlaying()).toBe(true);
  });

  it('reports an empty list and an unreachable server', async () => {
    const empty = service.loadPlaylist('buli');
    http.expectOne(`${music}/buli/playlist`).flush({ data: { tracks: [] } });
    expect(await empty).toBe(false);
    expect(service.error()).toBe('A lejátszási lista üres.');

    const failed = service.loadPlaylist('buli');
    http.expectOne(`${music}/buli/playlist`).flush('', { status: 502, statusText: 'Bad Gateway' });
    expect(await failed).toBe(false);
    expect(service.error()).toBe('A zene most nem érhető el.');
    expect(play).not.toHaveBeenCalled();
  });

  it('re-reads a playlist from the music server on reload', async () => {
    const done = service.loadPlaylist('buli', true);
    const req = http.expectOne(`${music}/buli/refresh`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: { tracks: [track('x')] } });
    expect(await done).toBe(true);
  });

  it('steps forward and back in order, wrapping around', async () => {
    await start([track('a'), track('b'), track('c')]);
    service.next();
    expect(service.currentTrack()?.id).toBe('b');
    service.next();
    service.next();
    expect(service.currentTrack()?.id).toBe('a');
    service.previous();
    expect(service.currentTrack()?.id).toBe('c');
  });

  it('restarts the track instead of stepping back once it is well under way', async () => {
    await start([track('a'), track('b')]);
    service.next();
    audio().currentTime = 10;
    service.previous();
    expect(service.currentTrack()?.id).toBe('b');
    expect(audio().currentTime).toBe(0);
  });

  it('never repeats the same track when shuffling, and ⏮ goes back in history', async () => {
    await start([track('a'), track('b'), track('c')]);
    service.shuffle.set(true);
    const seen = [service.index()];
    for (let i = 0; i < 20; i++) {
      service.next();
      expect(service.index()).not.toBe(seen.at(-1));
      seen.push(service.index());
    }
    service.previous();
    expect(service.index()).toBe(seen.at(-2));
  });

  it('jumps to a chosen track, also in the other playlist', async () => {
    await start([track('a'), track('b')]);
    await service.playAt(1);
    expect(service.currentTrack()?.id).toBe('b');

    const done = service.playAt(0, 'buli', 30);
    http.expectOne(`${music}/buli/playlist`).flush({ data: { tracks: [track('x')] } });
    await done;
    expect(service.activeKey()).toBe('buli');
    expect(service.currentTrack()?.id).toBe('x');
    audio().dispatchEvent(new Event('loadedmetadata'));
    expect(service.currentTime()).toBe(30);
  });

  it('follows the audio element: time, length, end of track', async () => {
    await start([track('a', { durationMs: null }), track('b')]);
    expect(service.duration()).toBe(0);
    service.seek(50); // length unknown yet - nowhere to seek
    expect(audio().currentTime).toBe(0);

    Object.defineProperty(audio(), 'duration', { configurable: true, value: 200 });
    audio().dispatchEvent(new Event('durationchange'));
    expect(service.duration()).toBe(200);
    service.seek(500);
    expect(audio().currentTime).toBe(200);
    audio().dispatchEvent(new Event('timeupdate'));
    expect(service.currentTime()).toBe(200);

    service.repeatOne.set(true);
    audio().dispatchEvent(new Event('ended'));
    expect(service.currentTrack()?.id).toBe('a');
    expect(audio().currentTime).toBe(0);

    service.repeatOne.set(false);
    audio().dispatchEvent(new Event('ended'));
    expect(service.currentTrack()?.id).toBe('b');
  });

  it('skips a track that cannot be played, and gives up when none can', async () => {
    await start([track('a'), track('b')]);
    audio().dispatchEvent(new Event('error'));
    expect(service.currentTrack()?.id).toBe('b');
    expect(service.error()).toBeNull();
    audio().dispatchEvent(new Event('error'));
    expect(service.error()).toBe('A zene most nem játszható le.');
    expect(service.isPlaying()).toBe(false);
  });

  it('stops and rewinds', async () => {
    service.stop(); // nothing started yet
    await start([track('a')]);
    audio().currentTime = 42;
    service.stop();
    expect(audio().currentTime).toBe(0);
    expect(service.isPlaying()).toBe(false);
  });

  it('is not playing when the browser refuses to start the sound', async () => {
    play.mockRejectedValue(new Error('NotAllowedError'));
    await start([track('a')]);
    await settle();
    expect(service.isPlaying()).toBe(false);
  });

  it('builds the cover URL of a track', () => {
    expect(service.imageSrc(null)).toBeNull();
    expect(service.imageSrc(track('a'))).toBeNull();
    expect(service.imageSrc(track('a', { imageUrl: '/music/image/a' }))).toBe(
      `${API}/music/image/a`,
    );
  });

  it('forgets everything on logout', async () => {
    const auth = TestBed.inject(AuthService);
    auth.checkAuth().subscribe();
    http.expectOne(`${API}/auth/me`).flush({ loggedIn: true, id: 'u1', role: 'member' });
    TestBed.tick();
    await start([track('a')]);

    auth.checkAuth().subscribe();
    http.expectOne(`${API}/auth/me`).flush({ loggedIn: false });
    TestBed.tick();
    expect(service.tracks()).toEqual([]);
    expect(service.isPlaying()).toBe(false);
    expect(audio().getAttribute('src')).toBeNull();
  });
});
