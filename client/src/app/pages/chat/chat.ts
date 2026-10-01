import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  signal,
  computed,
  effect,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { AuthService } from '../../auth/auth.service';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { TourSocketService } from '../../services/tour-socket';
import { MatIconModule } from '@angular/material/icon';
import { Feed } from '../../components/feed/feed';
import { RoomBoard } from './room-board/room-board';
import { TourService, Tour } from '../../services/tour';
import { ChatGame, ChatOverview, ChatService } from '../../services/chat';
import { Podium, PodiumWinner } from '../../shared/podium/podium';
import { ChatList } from './chat-list/chat-list';
import { TourCountdown } from '../../shared/tour-countdown/tour-countdown';
import { PushService } from '../../services/push';
import { NotificationsService } from '../../notifications/notifications.service';

// What the general room is called.
const GENERAL_NAME = 'Bódorgók';
// Below this width there's no sidebar: the list of chats is a screen of its
// own, and a chat opens over it (chat.scss's phone breakpoint).
const PHONE_QUERY = '(max-width: 580px)';
// How often the list's last messages and unread counts are asked for again,
// and how long after leaving a chat (the server notes it as read then).
const OVERVIEW_REFRESH_MS = 60_000;
const OVERVIEW_AFTER_LEAVING_MS = 600;
// The podium's try-out (?dobogo=proba): the first winner after this long,
// the next ones this far apart - each celebration (5 s) has time to end.
const PREVIEW_FIRST_MS = 2000;
const PREVIEW_EVERY_MS = 7000;

// The Szobabeosztás panel's width next to the chat, in px (see
// startResize) - remembered per browser, just a convenience.
const ROOMS_DEFAULT_WIDTH = 380;
const ROOMS_MIN_WIDTH = 320;
const CHAT_MIN_WIDTH = 360;
const ROOMS_WIDTH_KEY = 'bodorgo.chat.roomsWidth';

function readStoredRoomsWidth(): number {
  try {
    const stored = Number(localStorage.getItem(ROOMS_WIDTH_KEY));
    return stored >= ROOMS_MIN_WIDTH ? stored : ROOMS_DEFAULT_WIDTH;
  } catch {
    return ROOMS_DEFAULT_WIDTH;
  }
}

function storeRoomsWidth(width: number) {
  try {
    localStorage.setItem(ROOMS_WIDTH_KEY, String(width));
  } catch {
    // Storage unavailable (private mode...) - just not remembered.
  }
}

function finishDate(t: Tour): Date {
  const finish = new Date(t.startDate);
  finish.setDate(finish.getDate() + Math.max(t.duration - 1, 0));
  return finish;
}

// The one past tour whose chat stays writable: the one the chat is tested
// in. It's still listed among the archives.
const ALWAYS_WRITABLE_TOUR_ORDER = 11;

// A tour's chat is open until 14 days after its last day; from then on
// it's an archive, read-only (the server's rule - chat/chatRooms.js).
function isChatOpen(t: Tour): boolean {
  const closesAt = finishDate(t);
  closesAt.setDate(closesAt.getDate() + 14);
  return new Date() <= closesAt;
}

// Laid out like the Klub area: a dark tour list on the left (full names
// on a wide screen, round cover thumbnails below 1050px, a scrolling row
// of names on a phone - all pure CSS, see chat.scss), then the selected
// tour's chat and its Szobabeosztás (room allocation) panel - side by
// side on a very wide screen, otherwise as two tabs.
//
// On a phone there's no sidebar: the page opens on the full-screen list of
// chats (chat-list - also the past tours' archives), and a chosen chat
// opens over it, with a bar on top: ← back to the list, its name, how many
// people it has.
// The general Kotyogó's key in `selected` (tours use their ids).
const GENERAL = 'general';

@Component({
  selector: 'app-chat',
  imports: [
    Feed,
    MatIconModule,
    RoomBoard,
    CdkScrollable,
    TourCountdown,
    NgTemplateOutlet,
    ChatList,
    Podium,
  ],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat implements OnInit, OnDestroy {
  private tourService = inject(TourService);
  private tourSocket = inject(TourSocketService);
  private route = inject(ActivatedRoute);

  // What's open: the general Kotyogó ('general'), or a tour's (its id).
  selected = signal<string | null>(null);
  isGeneral = computed(() => this.selected() === GENERAL);
  selectedTourId = computed(() => (this.isGeneral() ? null : this.selected()));
  // Every tour, newest first, and the ones whose chat is open.
  allTours = signal<Tour[]>([]);
  visibleTours = computed(() => this.allTours().filter(isChatOpen));
  // The past tours that were chatted in - archives, read-only (the test
  // tour's is listed here too, though it can still be written in). A past
  // tour nobody ever wrote in isn't listed at all: nothing will ever be
  // said there.
  archivedTours = computed(() => {
    const written = new Set(
      (this.overview()?.tours ?? []).filter((t) => t.lastPost).map((t) => t.tourId),
    );
    return this.allTours().filter(
      (t) => !isChatOpen(t) && (written.has(t._id) || t.order === ALWAYS_WRITABLE_TOUR_ORDER),
    );
  });
  loaded = signal(false);
  readonly generalName = GENERAL_NAME;

  // Which of the two panes is shown while they're tabs (narrower screens)
  // - ignored when both fit side by side.
  activePane = signal<'chat' | 'rooms'>('chat');

  selectedTour = computed(
    () => this.allTours().find((t) => t._id === this.selectedTourId()) ?? null,
  );
  // A past tour's chat: an archive - read, not written.
  readOnly = computed(() => {
    const tour = this.selectedTour();
    return !!tour && !isChatOpen(tour) && tour.order !== ALWAYS_WRITABLE_TOUR_ORDER;
  });

  // --- The launch game: "the first three to write in Bódorgók" ---
  // Its podium stands at the top of the general room while there's
  // something to show (the server decides - chat/firstWritersGame.js).
  // Each new winner arrives over the socket ('chat-game') and is
  // celebrated on the spot; opened later, the winners are simply there.
  game = signal<ChatGame | null>(null);
  private previewing = () => this.route.snapshot.queryParamMap.get('dobogo') === 'proba';
  private podium = viewChild(Podium);
  podiumWinners = computed<PodiumWinner[]>(() =>
    (this.game()?.winners ?? []).map((w) => ({
      place: w.place,
      userId: w.userId,
      name: w.username || w.name,
      photoVersion: w.photoUpdatedAt,
    })),
  );
  private offGame?: () => void;

  private loadGame() {
    this.chatService.getGeneralGame().subscribe({
      next: (res) => this.game.set(res.data.game),
      error: () => {}, // no podium - the chat itself still works
    });
  }

  // A try-out, without the game: /chat?dobogo=proba shows the podium in
  // the general room and fills it with three made-up winners, a few
  // seconds apart, each with its celebration. Nothing is sent or saved.
  private previewGame() {
    const names = ['Próba Panni', 'Teszt Tomi', 'Minta Misi'];
    const startedAt = new Date().toISOString();
    const state = (count: number): ChatGame => ({
      startedAt,
      finishedAt: count === names.length ? new Date().toISOString() : null,
      places: names.length,
      winners: names.slice(0, count).map((name, i) => ({
        place: (i + 1) as 1 | 2 | 3,
        userId: `proba-${i}`,
        name,
        username: null,
        photoUpdatedAt: null,
        at: startedAt,
      })),
    });
    this.game.set(state(0));
    names.forEach((_, i) =>
      setTimeout(
        () => {
          this.game.set(state(i + 1));
          setTimeout(() => this.podium()?.celebrate(i + 1));
        },
        PREVIEW_FIRST_MS + i * PREVIEW_EVERY_MS,
      ),
    );
  }

  private watchGame() {
    this.offGame = this.tourSocket.on<{ game: ChatGame | null; newPlace: number | null }>(
      'chat-game',
      ({ game, newPlace }) => {
        this.game.set(game);
        // Once the new winner is on the page.
        if (newPlace) setTimeout(() => this.podium()?.celebrate(newPlace));
      },
    );
  }

  // --- The list's data: last message, unread count, people per room ---
  overview = signal<ChatOverview | null>(null);

  private loadOverview() {
    this.chatService.getOverview().subscribe({
      next: (res) => this.overview.set(res.data),
      error: (err) => console.error('Failed to load the chat overview', err),
    });
  }

  private summaryOf(key: string | null) {
    const overview = this.overview();
    if (!overview || !key) return null;
    return key === GENERAL ? overview.general : overview.tours.find((t) => t.tourId === key);
  }

  // Unread messages of a room - none for the one that's on screen.
  unreadOf(key: string): number {
    if (key === this.selected() && this.roomOnScreen()) return 0;
    return this.summaryOf(key)?.unread ?? 0;
  }

  // The list is kept fresh while the page is open: other chats' new
  // messages don't arrive here by themselves.
  private overviewTimer = setInterval(() => this.loadOverview(), OVERVIEW_REFRESH_MS);
  private onVisible = () => {
    if (document.visibilityState === 'visible') this.loadOverview();
  };

  // The open room's bar on a phone: its name and how many people it has.
  roomTitle = computed(() => {
    const tour = this.selectedTour();
    return tour ? `${tour.order}. ${tour.title}` : GENERAL_NAME;
  });
  roomPeople = computed(() => {
    const count = this.summaryOf(this.selected())?.memberCount;
    if (count == null) return '';
    return this.isGeneral() ? `${count} tag` : `${count} résztvevő`;
  });

  // --- Phone: the list of chats first, a chat over it ---
  // True while the list is the screen (a wider screen ignores it - both
  // are always there).
  listOnPhone = signal(true);
  private phoneQuery = window.matchMedia(PHONE_QUERY);
  private isPhone = signal(this.phoneQuery.matches);
  private onPhoneChange = () => this.isPhone.set(this.phoneQuery.matches);
  // Is the selected chat really shown? Always on a wide screen; on a phone
  // only once it's been opened from the list. Only then is its feed made -
  // a chat behind the list must not count as read.
  roomOnScreen = computed(() => !(this.isPhone() && this.listOnPhone()));
  // The open chat added a step to the browser's history, so the phone's
  // own Back button returns to the list (not out of the Kotyogó).
  private roomInHistory = false;
  private onPopState = () => {
    if (!this.roomInHistory) return;
    this.roomInHistory = false;
    this.showList();
  };

  private showList() {
    this.listOnPhone.set(true);
    this.refreshOverviewSoon(); // what I've just read is no longer unread
  }

  // After leaving a chat: once the server has noted it as read.
  private refreshOverviewSoon() {
    setTimeout(() => this.loadOverview(), OVERVIEW_AFTER_LEAVING_MS);
  }

  backToList() {
    if (this.roomInHistory) history.back();
    else this.showList();
  }

  private openRoom(key: string) {
    if (key !== this.selected()) this.refreshOverviewSoon();
    // The podium as it stands now (its live changes only reach an open chat).
    if (key === GENERAL && !this.previewing()) this.loadGame();
    this.selected.set(key);
    this.activePane.set('chat');
    this.listOnPhone.set(false);
    if (this.isPhone() && !this.roomInHistory) {
      history.pushState({ kotyogo: key }, '');
      this.roomInHistory = true;
    }
  }

  // The open chat's room (see ChatService) - asked for whenever the
  // selection changes; null until it's known.
  private chatService = inject(ChatService);
  chatRoomId = signal<string | null>(null);

  private loadChatRoom = effect(() => {
    const selected = this.selected();
    this.chatRoomId.set(null);
    if (!selected) return;
    if (selected === GENERAL) {
      this.tourSocket.leaveTour(); // no Szobabeosztás here
    } else {
      // The tour's channel on the shared connection: its Szobabeosztás.
      this.tourSocket.joinTour(selected);
    }
    const room =
      selected === GENERAL
        ? this.chatService.getGeneralChatRoom()
        : this.chatService.getTourChatRoom(selected);
    room.subscribe({
      next: (res) => {
        if (this.selected() === selected) this.chatRoomId.set(res.data.chatRoom._id);
      },
      error: (err) => console.error('Failed to load the chat room', err),
    });
  });

  // Forces <app-feed> to fully destroy/recreate (a fresh join-chat on the
  // shared connection, fresh history) whenever the room changes, instead of
  // Angular just patching its inputs in place.
  feedKey = computed(() => {
    const chatRoomId = this.chatRoomId();
    return chatRoomId && this.roomOnScreen() ? [{ chatRoomId, tourId: this.selectedTourId() }] : [];
  });

  ngOnInit() {
    window.addEventListener('popstate', this.onPopState);
    document.addEventListener('visibilitychange', this.onVisible);
    this.phoneQuery.addEventListener('change', this.onPhoneChange);
    this.loadOverview();
    if (this.route.snapshot.queryParamMap.get('dobogo') === 'proba') {
      this.listOnPhone.set(false); // straight into the general room
      this.previewGame();
    } else {
      this.loadGame();
      this.watchGame();
    }
    this.tourService.getTours().subscribe({
      next: (res) => {
        const list = [...res.data.tours].sort(
          (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
        );
        this.allTours.set(list);
        // /chat?tabor=<id> - e.g. from a push notification - opens that
        // tour's chat, /chat?kotyogo=altalanos the general one - on a phone
        // too, straight away. Otherwise the general one is selected, and a
        // phone starts on the list.
        const params = this.route.snapshot.queryParamMap;
        const wanted = list.find((t) => t._id === params.get('tabor'))?._id;
        this.selected.set(wanted ?? GENERAL);
        if (wanted || params.has('kotyogo')) this.listOnPhone.set(false);
        this.loaded.set(true);
      },
      error: (err) => {
        console.error('Failed to load tours for chat', err);
        this.loaded.set(true);
      },
    });
  }

  // Off the chat page: stop getting this tour's room changes (the feed
  // leaves its chat room itself).
  ngOnDestroy() {
    this.tourSocket.leaveTour();
    window.removeEventListener('popstate', this.onPopState);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.phoneQuery.removeEventListener('change', this.onPhoneChange);
    clearInterval(this.overviewTimer);
    this.offGame?.();
  }

  // --- "Másik háttér" (admins): the open feed switches its own background ---
  private auth = inject(AuthService);
  private feed = viewChild(Feed);
  canSwitchBackground = computed(
    () => this.auth.user()?.role === 'admin' && !!this.feed()?.backgroundImage(),
  );
  switchingBackground = computed(() => this.feed()?.switchingBackground() ?? false);

  nextBackground() {
    this.feed()?.nextBackground();
  }

  // --- Resizable Szobabeosztás panel (side-by-side layout only) ---
  // Each browser remembers its own width; it never affects anyone else.
  private panes = viewChild<ElementRef<HTMLElement>>('panes');
  roomsWidth = signal(readStoredRoomsWidth());
  resizing = signal(false);

  startResize(event: PointerEvent) {
    const panes = this.panes()?.nativeElement;
    if (!panes) return;
    event.preventDefault();
    this.resizing.set(true);
    const box = panes.getBoundingClientRect();

    const onMove = (e: PointerEvent) => {
      // The panel's width is the distance from the pointer to the right
      // edge - never below its minimum, and always leaving the chat
      // room to stay usable.
      const max = Math.max(ROOMS_MIN_WIDTH, box.width - CHAT_MIN_WIDTH);
      this.roomsWidth.set(
        Math.round(Math.min(Math.max(box.right - e.clientX, ROOMS_MIN_WIDTH), max)),
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.resizing.set(false);
      storeRoomsWidth(this.roomsWidth());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  resetRoomsWidth() {
    this.roomsWidth.set(ROOMS_DEFAULT_WIDTH);
    storeRoomsWidth(ROOMS_DEFAULT_WIDTH);
  }

  // The general Kotyogó - always there, for everyone logged in.
  selectGeneral() {
    this.openRoom(GENERAL);
  }

  selectTour(id: string) {
    this.openRoom(id);
  }

  // From the phone's list: 'general' or a tour's id.
  selectFromList(key: string) {
    this.openRoom(key);
  }

  // --- The selected chat's push notifications on/off (the bell) ---
  private push = inject(PushService);
  private notifications = inject(NotificationsService);
  chatMuted = signal(false);

  private loadMuted = effect(() => {
    const id = this.chatRoomId();
    this.chatMuted.set(false);
    if (!id) return;
    this.push.getChatMuted(id).subscribe({
      next: (res) => {
        if (this.chatRoomId() === id) this.chatMuted.set(res.data.muted);
      },
      error: () => {},
    });
  });

  toggleChatMuted() {
    const chatRoomId = this.chatRoomId();
    if (!chatRoomId) return;
    const next = !this.chatMuted();
    this.chatMuted.set(next);
    this.push.setChatMuted(chatRoomId, next).subscribe({
      next: () =>
        this.notifications.addSuccess(
          next
            ? 'Ennek a Kotyogónak az értesítései némítva.'
            : 'Értesítések ebből a Kotyogóból bekapcsolva.',
        ),
      error: () => {
        this.chatMuted.set(!next);
        this.notifications.addError('Nem sikerült menteni.');
      },
    });
  }

  coverUrl(t: Tour): string | null {
    return this.tourService.coverUrl(t);
  }

  // "2026. okt. 22." - Intl rather than the date pipe, since this app has
  // no Hungarian locale data registered (see tour-card.ts).
  formatDate(t: Tour): string {
    return new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(t.startDate));
  }
}
