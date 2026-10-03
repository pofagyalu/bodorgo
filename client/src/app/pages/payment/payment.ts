import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TourService, AttendeePayment, isInMyPaymentGroup } from '../../services/tour';
import { PaymentService, PaymentStatus } from '../../services/payment';
import { AuthService } from '../../auth/auth.service';
import { formatForint } from '../../shared/format';
import { PayProviderPicker } from '../../shared/pay-provider-picker/pay-provider-picker';
import { PAYMENT_METHOD_NAMES, PaymentMethodKey } from '../../services/settings';

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
// Pays via Stripe or Barion, whichever the payer picks (see
// shared/pay-provider-picker - one switched off on Klub → Beállítások is
// greyed out) - the gateway's own hosted page is where the payer actually
// enters card details. The picked gateway's fee is shown on top of the
// advances before paying; the server charges the same (see
// paymentController.js's chargeableAmount), never trusting this page's sum.
@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [RouterLink, PayProviderPicker],
  templateUrl: './payment.html',
  styleUrl: './payment.scss',
})
export class Payment {
  private route = inject(ActivatedRoute);
  private tourService = inject(TourService);
  private paymentService = inject(PaymentService);
  auth = inject(AuthService);
  readonly formatForint = formatForint;

  tourId = this.route.snapshot.paramMap.get('id')!;
  loading = signal(true);
  error = signal<string | null>(null);
  tourTitle = signal('');
  tourSlug = signal('');

  // Set once the browser is redirected back from the gateway's own
  // checkout page (see the ?paymentId= query param) - while this has a
  // value, the normal pick-who-to-pay form is replaced by a plain result
  // banner.
  returningPaymentId = this.route.snapshot.queryParamMap.get('paymentId');
  checkingResult = signal(false);
  resultStatus = signal<PaymentStatus | null>(null);

  // Everyone in the current user's own payment group (self + same
  // familyId) who actually has an advance amount to pay - not the whole
  // tour roster.
  myGroup = signal<AttendeePayment[]>([]);
  // Which of them to pay for right now - defaults to everyone in the
  // group, but a family member who's already settled up separately (e.g.
  // bank transfer) can be unchecked so they're left out of this payment.
  selectedAttendeeIds = signal<Set<string>>(new Set());
  starting = signal(false);

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

        if (this.returningPaymentId) {
          this.checkResult(this.returningPaymentId);
        }
      },
      error: () => {
        this.error.set('A tábor betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  private checkResult(paymentId: string) {
    this.checkingResult.set(true);
    this.paymentService.getPaymentStatus(paymentId).subscribe({
      next: (res) => {
        this.resultStatus.set(res.data.status);
        this.checkingResult.set(false);
      },
      error: () => {
        this.error.set('A fizetés állapotát nem sikerült lekérdezni.');
        this.checkingResult.set(false);
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

  // The gateway picked in the picker, and its fee on totalToPay (both set
  // by the picker).
  method = signal<PaymentMethodKey | null>(null);
  fee = signal(0);
  methodName = computed(() => {
    const method = this.method();
    return method ? PAYMENT_METHOD_NAMES[method] : '';
  });

  // What the gateway will actually charge, its fee on top.
  grandTotalToPay = computed(() => this.totalToPay() + this.fee());

  canPay = computed(() => this.selectedAttendeeIds().size > 0 && !!this.method());

  pay() {
    const method = this.method();
    if (!this.canPay() || this.starting() || !method) return;

    this.starting.set(true);
    this.error.set(null);
    this.paymentService
      .startTourAdvancePayment(this.tourId, [...this.selectedAttendeeIds()], method)
      .subscribe({
        next: (res) => {
          // A full navigation, not a client-side route change - the payer
          // needs to actually leave the site for the gateway's own hosted
          // page, then gets redirected straight back here (set server-side)
          // once done.
          window.location.href = res.data.gatewayUrl;
        },
        error: (err) => {
          this.error.set(err?.error?.message ?? 'Hiba történt a fizetés indítása során.');
          this.starting.set(false);
        },
      });
  }
}
