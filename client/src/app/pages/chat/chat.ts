import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Feed } from '../../components/feed/feed';
import { RoomBoard } from './room-board/room-board';
import { TourService, Tour } from '../../services/tour';

// Exempted from the close-after-14-days rule below so the tour we used to
// build/test the chat feature stays reachable even though it's long past -
// no need to keep every other past tour's (empty) chat around too.
const TEST_TOUR_ORDER = 11;

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
  imports: [Feed, MatIconModule, RoomBoard],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat implements OnInit {
  private tourService = inject(TourService);

  selectedTourId = signal<string | null>(null);
  visibleTours = signal<Tour[]>([]);
  loaded = signal(false);

  // Which of the two panes is shown while they're tabs (narrower screens)
  // - ignored when both fit side by side.
  activePane = signal<'chat' | 'rooms'>('chat');

  selectedTour = computed(
    () => this.visibleTours().find((t) => t._id === this.selectedTourId()) ?? null,
  );

  // Forces <app-feed> to fully destroy/recreate (fresh socket connection,
  // fresh join-tour-chat, fresh history fetch) whenever the selected tour
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
