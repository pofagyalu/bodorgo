import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Tour } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';

// The chat page's Szobabeosztás panel for the selected tour: its houses
// and rooms (set up on the tour edit page's Szállás section), each room
// with its places. For now every place is still empty - putting people
// into rooms (admin drag and drop, live for everyone) is the next step.
@Component({
  selector: 'app-room-board',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  templateUrl: './room-board.html',
  styleUrl: './room-board.scss',
})
export class RoomBoard {
  private auth = inject(AuthService);

  tour = input.required<Tour>();

  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  houses = computed(() => this.tour().accommodation?.houses ?? []);
  totalBeds = computed(() =>
    this.houses()
      .flatMap((h) => h.rooms)
      .reduce((sum, r) => sum + r.beds, 0),
  );

  // One entry per place in a room - drawn as empty bed slots.
  places(beds: number): number[] {
    return Array.from({ length: beds }, (_, i) => i);
  }
}
