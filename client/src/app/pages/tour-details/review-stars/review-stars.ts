import { Component, ElementRef, EventEmitter, HostListener, Input, Output, OnInit, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TourService } from '../../../services/tour';
import { NotificationsService } from '../../../notifications/notifications.service';

// Owns the whole "★ 7.5/10 (...)" line near the top of the tour details
// page - not just the star input. For a non-attendee, a tour that hasn't
// ended yet (or before getMyReview() resolves) it's the plain public average + review count,
// same as always. For an actual attendee of an ended tour it swaps the parenthetical for
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
  private host = inject(ElementRef<HTMLElement>);

  @Input({ required: true }) tourId!: string;
  @Input({ required: true }) averageRating!: number;
  @Input({ required: true }) reviewCount!: number;
  @Output() reviewSubmitted = new EventEmitter<{ average: number; quantity: number }>();

  readonly stars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  loaded = signal(false);
  isAttendee = signal(false);
  // Attendee of a tour that has already ended - only then can they rate it.
  canReview = signal(false);
  savedRating = signal<number | null>(null);
  hoverRating = signal<number | null>(null);
  submitting = signal(false);
  editing = signal(false);

  // Hovering previews over whatever's actually saved - reverts the instant
  // the mouse leaves without a click.
  displayRating = computed(() => this.hoverRating() ?? this.savedRating());

  ngOnInit() {
    this.refresh();
  }

  // Public so tour-details.ts can call it after a successful sign-up -
  // isAttendee only ever gets checked once here (ngOnInit above), but
  // signing up mid-visit changes the real answer without any of this
  // component's own @Inputs changing value, so nothing would otherwise
  // trigger a re-check and the "Értékelek" button stayed hidden until a
  // full page reload.
  refresh() {
    this.tourService.getMyReview(this.tourId).subscribe({
      next: (res) => {
        this.isAttendee.set(res.data.isAttendee);
        this.canReview.set(res.data.isAttendee && res.data.hasEnded);
        this.savedRating.set(res.data.rating);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  // stopPropagation: the button is swapped out of the DOM by this very
  // click, so the document listener below would otherwise see a click
  // "outside" and close the stars again straight away.
  startEditing(event: MouseEvent) {
    event.stopPropagation();
    this.editing.set(true);
  }

  // Changed their mind - a click anywhere outside the stars (or Escape)
  // puts the summary line back, nothing saved.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.editing() && !this.host.nativeElement.contains(event.target as Node)) {
      this.cancelEditing();
    }
  }

  @HostListener('document:keydown.escape')
  cancelEditing() {
    if (!this.editing() || this.submitting()) return;
    this.hoverRating.set(null);
    this.editing.set(false);
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
