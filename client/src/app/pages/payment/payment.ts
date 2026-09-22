import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TourService, AttendeePayment, isInMyPaymentGroup } from '../../services/tour';
import { AuthService } from '../../auth/auth.service';
import { formatForint } from '../../shared/format';

type PaymentMethod = 'card' | 'revolut';

// Advance-payment page for one family (or a lone attendee with no family
// on record) at a time - reached via the tour-details page's "Előleg
// befizetés" button, which only ever appears once the logged-in user is
// actually registered for that tour with a real advance amount to pay.
// Usually the reservation/booking is made in one person's name, but
// paying it back is a household task anyone in the family should be able
// to do - not just whoever happens to be logged in as the booker - so
// this lists everyone in the current user's own payment group (self +
// same familyId), not just the caller themselves.
//
// v1 scope (confirmed with the admin): get the UI to a ready-to-click Pay
// button - no real payment processor is wired up yet (a future pass would
// add e.g. SimplePay/OTP SimplePay or Barion for card payments, and a
// real Revolut payment link/API for that option).
@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  templateUrl: './payment.html',
  styleUrl: './payment.scss',
})
export class Payment {
  private route = inject(ActivatedRoute);
  private tourService = inject(TourService);
  auth = inject(AuthService);
  readonly formatForint = formatForint;

  tourId = this.route.snapshot.paramMap.get('id')!;
  loading = signal(true);
  error = signal<string | null>(null);
  tourTitle = signal('');
  tourSlug = signal('');

  // Everyone in the current user's own payment group (self + same
  // familyId) who actually has an advance amount to pay - not the whole
  // tour roster.
  myGroup = signal<AttendeePayment[]>([]);
  // Which of them to pay for right now - defaults to everyone in the
  // group, but a family member who's already settled up separately (e.g.
  // bank transfer) can be unchecked so they're left out of this payment.
  selectedAttendeeIds = signal<Set<string>>(new Set());
  paymentMethod = signal<PaymentMethod | null>(null);

  constructor() {
    this.tourService.getTour(this.tourId).subscribe({
      next: (res) => {
        this.tourTitle.set(res.data.tour.title);
        this.tourSlug.set(res.data.tour.slug);

        const me = this.auth.user();
        // Already-paid attendees are excluded entirely, not just
        // pre-unchecked - someone still able to (even accidentally)
        // select an already-paid person risks paying for them twice.
        // paid is this specific person's own real status (see
        // AttendeePayment's comment), not the whole reservation's.
        const mine = res.data.attendeePayments.filter(
          (p) => p.advance != null && !p.paid && isInMyPaymentGroup(p, me),
        );
        this.myGroup.set(mine);
        this.selectedAttendeeIds.set(new Set(mine.map((p) => p.attendeeId)));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('A tábor betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  isSelected(attendeeId: string): boolean {
    return this.selectedAttendeeIds().has(attendeeId);
  }

  toggleSelected(attendeeId: string) {
    this.selectedAttendeeIds.update((set) => {
      const next = new Set(set);
      if (next.has(attendeeId)) {
        next.delete(attendeeId);
      } else {
        next.add(attendeeId);
      }
      return next;
    });
  }

  totalToPay = computed(() => {
    const ids = this.selectedAttendeeIds();
    return this.myGroup()
      .filter((p) => ids.has(p.attendeeId))
      .reduce((sum, p) => sum + (p.advance ?? 0), 0);
  });

  selectMethod(method: PaymentMethod) {
    this.paymentMethod.set(method);
  }

  canPay = computed(() => this.paymentMethod() !== null && this.selectedAttendeeIds().size > 0);

  // Intentionally a no-op for now - see this file's own top comment on
  // why. A real implementation would kick off the chosen processor's
  // checkout flow here (redirect, embedded widget, etc.) for
  // totalToPay()'s amount.
  pay() {
    // Not implemented yet.
  }
}
