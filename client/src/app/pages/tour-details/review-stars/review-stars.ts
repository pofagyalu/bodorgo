import { Component, EventEmitter, Input, Output, OnInit, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TourService } from '../../../services/tour';
import { NotificationsService } from '../../../notifications/notifications.service';

// Owns the whole "★ 7.5/10 (...)" line near the top of the tour details
// page - not just the star input. For a non-attendee (or before
// getMyReview() resolves) it's the plain public average + review count,
// same as always. For an actual attendee it swaps the parenthetical for
// their own status ("még nem értékeltél" / "a te értékelésed N") plus an
// Értékelek/Módosítom button that swaps the whole line for the 10-star
// input - clicking a star submits immediately and swaps back to the
// summary line, updated.
@Component({
  selector: 'app-review-stars',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './review-stars.html',
  styleUrl: './review-stars.scss',
})
export class ReviewStars implements OnInit {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);

  @Input({ required: true }) tourId!: string;
  @Input({ required: true }) averageRating!: number;
  @Input({ required: true }) reviewCount!: number;
  @Output() reviewSubmitted = new EventEmitter<{ average: number; quantity: number }>();

  readonly stars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  loaded = signal(false);
  isAttendee = signal(false);
  savedRating = signal<number | null>(null);
  hoverRating = signal<number | null>(null);
  submitting = signal(false);
  editing = signal(false);

  // Hovering previews over whatever's actually saved - reverts the instant
  // the mouse leaves without a click.
  displayRating = computed(() => this.hoverRating() ?? this.savedRating());

  ngOnInit() {
    this.tourService.getMyReview(this.tourId).subscribe({
      next: (res) => {
        this.isAttendee.set(res.data.isAttendee);
        this.savedRating.set(res.data.rating);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  startEditing() {
    this.editing.set(true);
  }

  onHover(value: number) {
    this.hoverRating.set(value);
  }

  onLeave() {
    this.hoverRating.set(null);
  }

  onClick(value: number) {
    if (this.submitting()) return;
    this.submitting.set(true);

    this.tourService.submitReview(this.tourId, value).subscribe({
      next: (res) => {
        this.savedRating.set(res.data.rating);
        this.submitting.set(false);
        this.editing.set(false);
        this.notifications.addSuccess('Értékelés mentve');
        this.reviewSubmitted.emit({ average: res.data.ratingsAverage, quantity: res.data.ratingsQuantity });
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt az értékelés mentése közben.');
        this.submitting.set(false);
      },
    });
  }
}
