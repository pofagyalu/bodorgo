import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Mirrors paymentModel.js's own status enum - Stripe's own states,
// derived server-side from the Checkout Session's payment_status/status.
export type PaymentStatus = 'Prepared' | 'Started' | 'Succeeded' | 'Failed' | 'Canceled' | 'Expired';

export interface StartPaymentResponse {
  status: string;
  data: { gatewayUrl: string; paymentId: string };
}

export interface PaymentStatusResponse {
  status: string;
  data: { status: PaymentStatus; amount: number };
}

// This app has (at least) two things a payment can be for - a tour's
// advance (implemented) and a club member's yearly membership fee
// (planned, not built yet) - see paymentModel.js's own comment. Both go
// through the same Stripe Checkout start/status machinery, hence one
// shared service rather than folding this into TourService.
@Injectable({
  providedIn: 'root',
})
export class PaymentService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/payments`;

  startTourAdvancePayment(tourId: string, attendeeIds: string[]): Observable<StartPaymentResponse> {
    return this.http.post<StartPaymentResponse>(`${this.apiUrl}/start`, { tourId, attendeeIds });
  }

  // Admin-only (see paymentRoutes.js's restrictTo('admin')) - for the real
  // case where someone hands an admin cash instead of paying online. No
  // Stripe involved, so this resolves immediately rather than returning a
  // gatewayUrl to redirect to.
  recordCashPayment(tourId: string, attendeeIds: string[]): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiUrl}/cash`, { tourId, attendeeIds });
  }

  // Admin-only - undoes a cash entry made by mistake (wrong row clicked),
  // reverting the attendee(s) it covered back to unpaid. See
  // paymentController.js's deleteCashPayment - it refuses anything that
  // isn't method: 'cash', so this can never touch a real Stripe payment.
  deleteCashPayment(paymentId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${paymentId}`);
  }

  // Polled by the payment page once the browser is redirected back from
  // Stripe's Checkout page - reconciles with Stripe directly server-side,
  // so it's accurate even if the async webhook is delayed or (on a dev
  // machine) can never arrive at all.
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
}
