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
import { ChatService } from '../../services/chat';
import { TourCountdown } from '../../shared/tour-countdown/tour-countdown';
import { PushService } from '../../services/push';
import { NotificationsService } from '../../notifications/notifications.service';

// Exempted from the close-after-14-days rule below so the tour we used to
// build/test the chat feature stays reachable even though it's long past -
// no need to keep every other past tour's (empty) chat around too.
const TEST_TOUR_ORDER = 11;

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

function isChatOpen(t: Tour): boolean {
  if (t.order === TEST_TOUR_ORDER) return true;
  const closesAt = finishDate(t);
  closesAt.setDate(closesAt.getDate() + 14);
  return new Date() <= closesAt;
}

// Laid out like the Klub area: a dark tour list on the left (full names
// on a wide screen, round cover thumbnails below 1050px, a scrolling row
// of names on a phone - all pure CSS, see chat.scss), then the selected
// tour's chat and its Szobabeosztás (room allocation) panel - side by
// side on a very wide screen, otherwise as two tabs.
// The general Kotyogó's key in `selected` (tours use their ids).
const GENERAL = 'general';

@Component({
  selector: 'app-chat',
  imports: [Feed, MatIconModule, RoomBoard, CdkScrollable, TourCountdown, NgTemplateOutlet],
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
  visibleTours = signal<Tour[]>([]);
  loaded = signal(false);

  // Which of the two panes is shown while they're tabs (narrower screens)
  // - ignored when both fit side by side.
  activePane = signal<'chat' | 'rooms'>('chat');

  selectedTour = computed(
    () => this.visibleTours().find((t) => t._id === this.selectedTourId()) ?? null,
  );

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
    return chatRoomId ? [{ chatRoomId, tourId: this.selectedTourId() }] : [];
  });

  ngOnInit() {
    this.tourService.getTours().subscribe({
      next: (res) => {
        const list = res.data.tours
          .filter(isChatOpen)
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        this.visibleTours.set(list);
        // /chat?tabor=<id> - e.g. from a push notification - opens that
        // tour's chat; otherwise (or /chat?kotyogo=altalanos) the general one.
        const wanted = this.route.snapshot.queryParamMap.get('tabor');
        this.selected.set(list.find((t) => t._id === wanted)?._id ?? GENERAL);
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
    this.selected.set(GENERAL);
    this.activePane.set('chat');
  }

  selectTour(id: string) {
    this.selected.set(id);
    this.activePane.set('chat');
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
