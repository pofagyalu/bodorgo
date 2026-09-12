import { Component, OnInit, inject, signal } from '@angular/core';
import { Feed } from '../../components/feed/feed';
import { TourService, Tour } from '../../services/tour';

// v1: chat is tied to a single hardcoded test tour (order 11) since there's
// no real future tour recorded yet, and no tour-picker/scheduling UI built
// yet either - see the chat feature plan for the follow-up that replaces
// this with "nearest upcoming tour" + a slide-in history menu.
const TEST_TOUR_ORDER = 11;

@Component({
  selector: 'app-chat',
  imports: [Feed],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat implements OnInit {
  private tourService = inject(TourService);

  tour = signal<Tour | null>(null);

  ngOnInit() {
    this.tourService.getTours().subscribe({
      next: (res) => {
        const match = res.data.tours.find((t) => t.order === TEST_TOUR_ORDER);
        this.tour.set(match ?? null);
      },
      error: (err) => console.error('Failed to load tours for chat', err),
    });
  }
}
