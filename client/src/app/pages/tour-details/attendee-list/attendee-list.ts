import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TourService, PaymentTotals } from '../../../services/tour';
import { PaymentService } from '../../../services/payment';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { formatForint } from '../../../shared/format';

export interface AttendeeListRow {
  reservationId: string;
  attendeeId: string;
  name: string;
  nights: number;
  familyId: string | null;
  totalPrice: number | null;
  advance: number | null;
  rest: number | null;
  paid: boolean;
}

// A row plus which alternating family "stripe" it belongs to (0 or 1),
// for the alternating white/light-grey background per family - see
// groupedAttendees below.
export interface StripedAttendeeRow extends AttendeeListRow {
  familyStripe: 0 | 1;
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
  private paymentService = inject(PaymentService);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);

  @Input({ required: true }) tourId!: string;
  @Input({ required: true }) attendees!: AttendeeListRow[];
  @Input() totals: PaymentTotals | null = null;
  // Fires after a nights edit (or a cash payment gets recorded) saves
  // successfully - the parent reloads the whole tour rather than this
  // component recomputing totals itself, keeping the payment formula in
  // exactly one place (the server).
  @Output() nightsUpdated = new EventEmitter<void>();

  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  readonly formatForint = formatForint;
  hasPricing = computed(() => this.totals !== null);

  // Grouped by family (so relatives sit together and can find themselves
  // at a glance, and so payment status is easy to eyeball per family)
  // instead of a flat alphabetical list - each family (or lone attendee
  // with no family on record, its own single-person "group") gets an
  // alternating white/light-grey background, see attendee-list.scss's
  // .attendee-row--stripe. A plain getter (re-run every change-detection
  // pass) rather than a computed signal, since `attendees` is a classic
  // @Input(), not a signal input - fine for a roster this size.
  get groupedAttendees(): StripedAttendeeRow[] {
    const groups = new Map<string, AttendeeListRow[]>();
    for (const a of this.attendees) {
      // No family on record: each such attendee is its own group, keyed
      // by their own id so they never merge with another family-less
      // attendee.
      const key = a.familyId ?? `solo-${a.attendeeId}`;
      const group = groups.get(key);
      if (group) {
        group.push(a);
      } else {
        groups.set(key, [a]);
      }
    }

    for (const members of groups.values()) {
      members.sort((x, y) => x.name.localeCompare(y.name, 'hu'));
    }

    // Families ordered by their own first (alphabetically earliest)
    // member, so the roster still reads roughly alphabetically at a
    // glance rather than in arbitrary family-creation order.
    const orderedGroups = [...groups.values()].sort((a, b) => a[0].name.localeCompare(b[0].name, 'hu'));

    return orderedGroups.flatMap((members, i) =>
      members.map((m) => ({ ...m, familyStripe: (i % 2) as 0 | 1 })),
    );
  }

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

  // Real case: a friend hands the admin cash instead of transferring the
  // advance online - the admin marks it paid on their behalf right here,
  // no Stripe involved (see paymentController.js's recordCashPayment).
  // Tracked per attendeeId (not a single "saving" flag) so marking one
  // person doesn't disable every other row's button while the request is
  // in flight.
  markingCashPaidId = signal<string | null>(null);

  markCashPaid(row: AttendeeListRow) {
    if (this.markingCashPaidId()) return;
    this.markingCashPaidId.set(row.attendeeId);
    this.paymentService.recordCashPayment(this.tourId, [row.attendeeId]).subscribe({
      next: () => {
        this.markingCashPaidId.set(null);
        this.notifications.addSuccess(`${row.name} előlege készpénzesen kifizetettnek jelölve.`);
        this.nightsUpdated.emit();
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a rögzítés során.');
        this.markingCashPaidId.set(null);
      },
    });
  }
}
