import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PaymentTotals, Tour, TourService } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { AttendeeList, AttendeeListRow } from '../attendee-list/attendee-list';

// A tour's Résztvevők (tour-details): the heading row - it opens and closes
// the list, with the head count, "Megtelt" and an admin's Excel export - and
// under it the attendee list. Who is on the list, the count and the totals
// are worked out by tour-details, which needs them for the sign-up and the
// program too; after an admin changed someone's nights it reloads the tour
// (nightsUpdated).
@Component({
  selector: 'app-tour-participants',
  imports: [MatIconModule, AttendeeList],
  templateUrl: './tour-participants.html',
  styleUrl: './tour-participants.scss',
})
export class TourParticipants {
  private tourService = inject(TourService);
  private auth = inject(AuthService);

  tour = input.required<Tour>();
  attendees = input.required<AttendeeListRow[]>();
  participantCount = input(0);
  isFull = input(false);
  totals = input<PaymentTotals | null>(null);
  // Profile photo versions, for the list's avatars.
  userPhotos = input<Record<string, string>>({});
  nightsUpdated = output<void>();

  isAdmin = computed(() => this.auth.user()?.role === 'admin');

  // Restores whatever expand/collapse choice was last made (see
  // tour.ts's showParticipantsPreference), instead of always resetting to
  // collapsed when navigating back to a tour.
  showParticipants = signal(this.tourService.showParticipantsPreference);

  toggleParticipants() {
    const next = !this.showParticipants();
    this.showParticipants.set(next);
    this.tourService.showParticipantsPreference = next;
  }

  attendeesExcelUrl(tourId: string): string {
    return this.tourService.attendeesExcelUrl(tourId);
  }
}
