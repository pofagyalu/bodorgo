import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Mirrors paymentModel.js's own status enum - derived server-side from
// whichever gateway's own status (Stripe's Checkout Session, or Barion's
// GetPaymentState).
export type PaymentStatus =
  'Prepared' | 'Started' | 'Succeeded' | 'Failed' | 'Canceled' | 'Expired';

export interface StartPaymentResponse {
  status: string;
  data: { gatewayUrl: string; paymentId: string };
}

export interface PaymentStatusResponse {
  status: string;
  data: { status: PaymentStatus; amount: number };
}

// Money collected via Barion sits in one of two separate wallets (see
// server/src/config.js's barion.membership/.tour) - one per purpose,
// matching Payment.purpose itself.
export type WithdrawalPurpose = 'membershipFee' | 'tourAdvance';

export interface WithdrawalStatusResponse {
  status: string;
  data: { configured: boolean };
}

export interface WithdrawResponse {
  status: string;
  data: { fee: number; net: number };
}

// This app has (at least) two things a payment can be for - a tour's
// advance (implemented) and a club member's yearly membership fee
// (implemented) - see paymentModel.js's own comment. Both go through the
// same gateway-agnostic start/status machinery server-side (Stripe or
// Barion - see paymentController.js's startGatewayPayment), hence one
// shared service rather than folding this into TourService.
@Injectable({
  providedIn: 'root',
})
export class PaymentService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/payments`;

  // method is hardcoded to 'barion' here rather than exposed as a client
  // choice - the server fully supports Stripe too (see
  // paymentController.js), it's just not offered on screen for now. Change
  // these two literals (and payment.html's/members.html's own gateway
  // copy) if that changes.
  startTourAdvancePayment(tourId: string, attendeeIds: string[]): Observable<StartPaymentResponse> {
    return this.http.post<StartPaymentResponse>(`${this.apiUrl}/start`, {
      tourId,
      attendeeIds,
      method: 'barion',
    });
  }

  // Pays exactly the given person+year pairs (1000 Ft each, combined into
  // one payment) - e.g. two different unpaid years for the same person, or
  // one year each for several family members. The server re-validates
  // every pair itself (self + same family, real club members only, really
  // still unpaid) rather than trusting amounts from here.
  startMembershipPayment(
    items: { userId: string; year: number }[],
  ): Observable<StartPaymentResponse> {
    return this.http.post<StartPaymentResponse>(`${this.apiUrl}/membership/start`, {
      items,
      method: 'barion',
    });
  }

  // Admin-only (see paymentRoutes.js's restrictTo('admin')) - for the real
  // case where someone hands an admin cash instead of paying online. No
  // Stripe involved, so this resolves immediately rather than returning a
  // gatewayUrl to redirect to.
  recordCashPayment(tourId: string, attendeeIds: string[]): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiUrl}/cash`, { tourId, attendeeIds });
  }

  // Admin-only - a member handed over one year's dues in cash (see
  // paymentController.js's recordCashMembershipPayment).
  recordCashMembershipPayment(userId: string, year: number): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiUrl}/cash-membership`, { userId, year });
  }

  // Admin-only - undoes a cash entry made by mistake (wrong row clicked),
  // reverting the attendee(s) it covered back to unpaid. See
  // paymentController.js's deleteCashPayment - it refuses anything that
  // isn't method: 'cash', so this can never touch a real Stripe payment.
  deleteCashPayment(paymentId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${paymentId}`);
  }

  // Polled by the payment page once the browser is redirected back from
  // the gateway's own hosted page - reconciles with that gateway directly
  // server-side, so it's accurate even if the async webhook/callback is
  // delayed or (on a dev machine) can never arrive at all.
  getPaymentStatus(paymentId: string): Observable<PaymentStatusResponse> {
    return this.http.get<PaymentStatusResponse>(`${this.apiUrl}/${paymentId}/status`);
  }

  // A plain GET URL, not an HttpClient call - the browser navigates/
  // downloads directly (see profile.html's <a [href]>), same as the tour
  // PDF/documents downloads. Requires being logged in as the payment's
  // own payer (or an admin) - the session cookie rides along
  // automatically, same cross-origin behavior already proven by those
  // other requireAuth-gated downloads.
  receiptUrl(paymentId: string): string {
    return `${this.apiUrl}/${paymentId}/receipt`;
  }

  // Admin-only. Whether this wallet's WALLET_KEY/WITHDRAW_NAME/
  // WITHDRAW_IBAN are all actually set server-side yet (see config.js) -
  // drives the finance page's withdraw button being disabled ("inactive")
  // until a real, live Barion wallet exists for that purpose.
  getWithdrawalStatus(purpose: WithdrawalPurpose): Observable<WithdrawalStatusResponse> {
    return this.http.get<WithdrawalStatusResponse>(`${this.apiUrl}/withdraw/${purpose}`);
  }

  // Admin-only - pulls real money out of the given wallet into its own
  // fixed, preconfigured bank account (never a client-supplied one, see
  // paymentController.js's withdrawFunds). Barion's own ~0.1%/min 70 Ft fee
  // is deducted on their end; the response's fee/net are just for display,
  // not something this call can influence.
  withdraw(purpose: WithdrawalPurpose, amount: number): Observable<WithdrawResponse> {
    return this.http.post<WithdrawResponse>(`${this.apiUrl}/withdraw`, { purpose, amount });
  }
}
