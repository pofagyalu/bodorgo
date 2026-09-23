import { Component, OnInit, HostListener, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Feed } from '../../components/feed/feed';
import { TourService, Tour } from '../../services/tour';

// Exempted from the close-after-14-days rule below so the tour we used to
// build/test the chat feature stays reachable even though it's long past -
// no need to keep every other past tour's (empty) chat around too.
const TEST_TOUR_ORDER = 11;

// Below this width the sidebar defaults to its compact, icon-only rail -
// matches the app's other mobile breakpoints closely enough while still
// leaving room for a real two-column layout on small tablets.
const NARROW_QUERY = '(max-width: 700px)';

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

@Component({
  selector: 'app-chat',
  imports: [Feed, MatIconModule],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat implements OnInit {
  private tourService = inject(TourService);

  selectedTourId = signal<string | null>(null);
  visibleTours = signal<Tour[]>([]);

  sidebarCollapsed = signal(this.matchesNarrow());
  // Once the user manually toggles the sidebar, stop overriding their
  // choice on resize - only the untouched, auto-computed default reacts
  // to window width from then on.
  private userToggledSidebar = false;

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
      },
      error: (err) => console.error('Failed to load tours for chat', err),
    });
  }

  selectTour(id: string) {
    this.selectedTourId.set(id);
    this.sidebarCollapsed.set(true);
  }

  toggleSidebar() {
    this.userToggledSidebar = true;
    this.sidebarCollapsed.update((v) => !v);
  }

  @HostListener('window:resize')
  onResize() {
    if (!this.userToggledSidebar) {
      this.sidebarCollapsed.set(this.matchesNarrow());
    }
  }

  private matchesNarrow(): boolean {
    return typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;
  }
}
