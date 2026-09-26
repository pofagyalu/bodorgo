import { Component, ElementRef, OnDestroy, OnInit, inject, signal, computed, viewChild } from '@angular/core';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { TourSocketService } from '../../services/tour-socket';
import { MatIconModule } from '@angular/material/icon';
import { Feed } from '../../components/feed/feed';
import { RoomBoard } from './room-board/room-board';
import { TourService, Tour } from '../../services/tour';
import { TourCountdown } from '../../shared/tour-countdown/tour-countdown';

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
@Component({
  selector: 'app-chat',
  imports: [Feed, MatIconModule, RoomBoard, CdkScrollable, TourCountdown],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat implements OnInit, OnDestroy {
  private tourService = inject(TourService);
  private tourSocket = inject(TourSocketService);

  selectedTourId = signal<string | null>(null);
  visibleTours = signal<Tour[]>([]);
  loaded = signal(false);

  // Which of the two panes is shown while they're tabs (narrower screens)
  // - ignored when both fit side by side.
  activePane = signal<'chat' | 'rooms'>('chat');

  selectedTour = computed(
    () => this.visibleTours().find((t) => t._id === this.selectedTourId()) ?? null,
  );

  // Forces <app-feed> to fully destroy/recreate (fresh join-tour-chat on
  // the shared connection, fresh history) whenever the selected tour
  // changes, instead of Angular just patching its tourId input in place.
  feedKey = computed(() => (this.selectedTourId() ? [this.selectedTourId()!] : []));

  ngOnInit() {
    this.tourService.getTours().subscribe({
      next: (res) => {
        const list = res.data.tours
          .filter(isChatOpen)
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        this.visibleTours.set(list);
        this.selectedTourId.set(list[0]?._id ?? null);
        this.loaded.set(true);
      },
      error: (err) => {
        console.error('Failed to load tours for chat', err);
        this.loaded.set(true);
      },
    });
  }

  // Off the chat page: stop getting this tour's live posts/room changes.
  ngOnDestroy() {
    this.tourSocket.leaveTour();
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
      this.roomsWidth.set(Math.round(Math.min(Math.max(box.right - e.clientX, ROOMS_MIN_WIDTH), max)));
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

  selectTour(id: string) {
    this.selectedTourId.set(id);
    this.activePane.set('chat');
  }

  coverUrl(t: Tour): string | null {
    return this.tourService.coverUrl(t);
  }

  // "2026. okt. 22." - Intl rather than the date pipe, since this app has
  // no Hungarian locale data registered (see tour-card.ts).
  formatDate(t: Tour): string {
    return new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' }).format(
      new Date(t.startDate),
    );
  }
}
