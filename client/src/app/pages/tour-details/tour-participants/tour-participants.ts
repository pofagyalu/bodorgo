import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PaymentTotals, Tour, TourService } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { AttendeeList, AttendeeListRow } from '../attendee-list/attendee-list';
import { formatEuro, formatForint } from '../../../shared/format';

// A tour's Résztvevők (tour-details): the heading row - the head count, "Megtelt" and an admin's Excel export - and
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
  // Never below 0, even if more signed up than the tour has places.
  freePlaces = computed(() => Math.max(0, this.tour().maxCapacity - this.participantCount()));

  // "Előleg befizetve 2026. febr. 1. · 45 980 Ft" (13,60 € on a EUR tour):
  // when the advances were declared paid, and what came in, in the
  // currency it was paid in. Null before.
  advancePaidNote = computed(() => {
    const at = this.tour().advancePaidAt;
    if (!at) return null;
    const date = new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(at));
    // A EUR tour's advances were paid in euros: the sum in euros, no Ft.
    // Everything that came in - people who withdrew since included.
    const totals = this.totals();
    const sum =
      totals?.advancePaidTotal == null
        ? null
        : this.tour().accommodationCurrency === 'EUR'
          ? `${formatEuro(totals.advancePaidTotalInCurrency ?? 0)} €`
          : `${formatForint(totals.advancePaidTotal)} Ft`;
    return sum ? `Előleg befizetve ${date} · ${sum}` : `Előleg befizetve ${date}`;
  });

  attendeesExcelUrl(tourId: string): string {
    return this.tourService.attendeesExcelUrl(tourId);
  }
}
