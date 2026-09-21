import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TourService, PaymentTotals } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { formatForint } from '../../../shared/format';

export interface AttendeeListRow {
  reservationId: string;
  attendeeId: string;
  name: string;
  nights: number;
  totalPrice: number | null;
  advance: number | null;
  rest: number | null;
  paid: boolean;
}

// The tour-details "Résztvevők" list, doing double duty: a plain roster
// for anyone looking at the tour, and (once an admin has set the tour's
// accommodationPricePerNight/advancePaymentPercentage) each person's own
// accommodation breakdown - Teljes ár/Foglaló/Maradék, visible to
// everyone, not admin-only. Only the Éjszakák (nights) cell has an edit
// affordance, and only for an admin - the rare correction for someone
// leaving a night early.
@Component({
  selector: 'app-attendee-list',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './attendee-list.html',
  styleUrl: './attendee-list.scss',
})
export class AttendeeList {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);

  @Input({ required: true }) tourId!: string;
  @Input({ required: true }) attendees!: AttendeeListRow[];
  @Input() totals: PaymentTotals | null = null;
  // Fires after a nights edit saves successfully - the parent reloads the
  // whole tour rather than this component recomputing totals itself,
  // keeping the payment formula in exactly one place (the server).
  @Output() nightsUpdated = new EventEmitter<void>();

  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  readonly formatForint = formatForint;
  hasPricing = computed(() => this.totals !== null);

  editingAttendeeId = signal<string | null>(null);
  editNights = 0;
  savingNights = signal(false);

  startEditNights(row: AttendeeListRow) {
    this.editNights = row.nights;
    this.editingAttendeeId.set(row.attendeeId);
  }

  cancelEditNights() {
    this.editingAttendeeId.set(null);
  }

  saveNights(row: AttendeeListRow) {
    if (!Number.isInteger(this.editNights) || this.editNights < 0) {
      this.notifications.addError('Az éjszakák száma nem lehet negatív egész szám.');
      return;
    }

    this.savingNights.set(true);
    this.tourService.updateAttendeeNights(this.tourId, row.reservationId, row.attendeeId, this.editNights).subscribe({
      next: () => {
        this.savingNights.set(false);
        this.editingAttendeeId.set(null);
        this.notifications.addSuccess('Éjszakák száma mentve');
        this.nightsUpdated.emit();
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
        this.savingNights.set(false);
      },
    });
  }
}
