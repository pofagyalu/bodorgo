import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ToursResponse {
  status: string;
  results: number;
  data: {
    tours: Tour[];
  };
}

export interface EventParticipant {
  user: string;
  name: string;
}

export interface ScheduleEntry {
  _id: string;
  day: number;
  time: string;
  description: string;
  isOptional?: boolean;
  extraCost?: number;
  participants?: EventParticipant[];
}

export interface ToggleParticipationResponse {
  status: string;
  data: {
    joined: boolean;
    participants: EventParticipant[];
  };
}

export interface UpdateScheduleEventPayload {
  time?: string;
  description?: string;
  isOptional?: boolean;
  extraCost?: number;
}

export interface UpdateScheduleEventResponse {
  status: string;
  data: {
    event: ScheduleEntry;
  };
}

export interface CreateScheduleEventPayload {
  day: number;
  time: string;
  description: string;
  isOptional?: boolean;
  extraCost?: number;
}

export interface CreateScheduleEventResponse {
  status: string;
  data: {
    event: ScheduleEntry;
  };
}

export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'thunderstorm';

export interface DailyWeather {
  day: number;
  condition: WeatherCondition;
  tempDayC: number;
  tempNightC: number;
  windSpeedKmh: number;
  // Forecast while the day is still upcoming; the real recorded weather,
  // frozen forever, once the day has passed.
  isFinal: boolean;
}

export interface Attendee {
  user: string;
  name: string;
}

export interface Reservation {
  _id: string;
  bookedBy: { _id: string; name: string; email: string };
  attendees: Attendee[];
  paid: boolean;
}

export interface Tour {
  _id: string;
  order: number;
  title: string;
  slug: string;
  location: {
    description: string;
    type: string;
    coordinates: number[];
    address: string;
  };
  coordinates: string;
  // Real road distance from Budapest, computed server-side and cached -
  // undefined until the server has a routing API key configured and this
  // tour has been saved/updated at least once since.
  distanceFromBudapestKm?: number;
  startDate: string;
  duration: number;
  participants: number;
  maxCapacity: number;
  ratingsAverage: number;
  ratingsQuantity: number;
  // Average price per person per night (accommodationPricePerNight /
  // maxCapacity), assuming the tour fills up - no longer admin-entered,
  // server-derived once accommodationPricePerNight is set (see
  // tourModel.js's pre('save') hook), so it stays unset until then.
  // tour-card.html shows "Nincs adat" for that gap.
  price?: number;
  summary: string;
  description: string;
  imageCover: string;
  images: string[];
  // Only populated on the single-tour endpoint (getTour), not the list one.
  schedule?: ScheduleEntry[];
  dailyWeather?: DailyWeather[];
  reservations?: Reservation[];
  // The three inputs behind each attendee's accommodation breakdown (see
  // AttendeePayment below) - all optional, a tour with none of these set
  // simply has no payment breakdown to show yet.
  accommodationPricePerNight?: number;
  advancePaymentPercentage?: number;
  clubSubsidyAmount?: number;
}

// One attendee's accommodation share, computed server-side from the
// tour's accommodationPricePerNight/advancePaymentPercentage/
// clubSubsidyAmount (see reservationController.js's
// computeAttendeePayments) - never stored, so editing those tour fields
// recalculates every attendee immediately. totalPrice/advance/rest are
// all null when the tour has no pricing configured yet. reservationId/
// attendeeId identify exactly which attendee subdocument to target for
// updateAttendeeNights.
export interface AttendeePayment {
  reservationId: string;
  attendeeId: string;
  name: string;
  nights: number;
  totalPrice: number | null;
  advance: number | null;
  rest: number | null;
}

export interface PaymentTotals {
  totalPrice: number;
  advance: number;
  rest: number;
}

export interface TourResponse {
  status: string;
  data: {
    tour: Tour;
    participantCount: number;
    attendeePayments: AttendeePayment[];
    paymentTotals: PaymentTotals | null;
  };
}

// Shape for both createTour and updateTour - a partial on update (only the
// changed fields need to be sent), but order/title/etc. are all required
// when creating a brand new tour (enforced server-side, not just here).
export interface TourPayload {
  order?: number;
  title?: string;
  location?: {
    description?: string;
    address?: string;
    coordinates?: number[];
  };
  startDate?: string;
  duration?: number;
  maxCapacity?: number;
  price?: number;
  summary?: string;
  description?: string;
  imageCover?: string;
  accommodationPricePerNight?: number;
  advancePaymentPercentage?: number;
  clubSubsidyAmount?: number;
}

export interface SignUpResponse {
  status: string;
  data: {
    reservation: Reservation;
  };
}

// width/height are what PhotoSwipe needs upfront for every slide to size
// and zoom correctly; size (bytes) drives the "download all" zip button's
// total-size tooltip. restricted (admin-only, set by hand per photo) means
// only that tour's own attendees (plus an admin) can see it - anyone else
// never receives it in this list at all, see tourImageController.js.
export interface TourImage {
  filename: string;
  width: number;
  height: number;
  size: number;
  restricted: boolean;
}

export interface TourImagesResponse {
  status: string;
  data: {
    images: TourImage[];
  };
}

export interface MyReviewResponse {
  status: string;
  data: {
    isAttendee: boolean;
    rating: number | null;
  };
}

export interface SubmitReviewResponse {
  status: string;
  data: {
    rating: number;
    ratingsAverage: number;
    ratingsQuantity: number;
  };
}

export interface TourStatsResponse {
  status: string;
  data: {
    totalTours: number;
    totalParticipants: number;
    // The gender split pooled across every tour attendee on record (not
    // every registered user - see tourController.js's getTourStats). null
    // until at least one attendee has a gender on file.
    genderRatio: { malePercentage: number; femalePercentage: number } | null;
    mostAttendedTour: {
      _id: string;
      title: string;
      order: number;
      slug: string;
      participantCount: number;
    } | null;
    bestRatedTour: {
      _id: string;
      title: string;
      order: number;
      slug: string;
      ratingsAverage: number;
      ratingsQuantity: number;
    } | null;
  };
}

@Injectable({
  providedIn: 'root',
})
export class TourService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/tours`;

  // Remembers the Tours page's "last 3" vs "all" choice across navigation -
  // the Tours component gets destroyed and recreated every time you
  // navigate back to it, wiping its own signals, but this service is a
  // singleton that lives for the app's session.
  showAllPreference = false;

  getTours(): Observable<ToursResponse> {
    return this.http.get<ToursResponse>(this.apiUrl);
  }

  /** Get the last 3 tours */
  getLast3Tours(): Observable<ToursResponse> {
    return this.http.get<ToursResponse>(`${this.apiUrl}/last-3`);
  }

  /** Optional: Get tours with query params (sorting/filtering/pagination) */
  getToursWithParams(params: Record<string, any>): Observable<ToursResponse> {
    return this.http.get<ToursResponse>(this.apiUrl, { params });
  }

  getTour(id: string): Observable<TourResponse> {
    return this.http.get<TourResponse>(`${this.apiUrl}/${id}`);
  }

  createTour(payload: TourPayload): Observable<TourResponse> {
    return this.http.post<TourResponse>(this.apiUrl, payload);
  }

  updateTour(id: string, payload: TourPayload): Observable<TourResponse> {
    return this.http.patch<TourResponse>(`${this.apiUrl}/${id}`, payload);
  }

  // attendeeIds is who to register in this one reservation - who the
  // caller is actually allowed to include is enforced server-side based on
  // their role (see reservationController.js's assertCanRegister).
  signUp(tourId: string, attendeeIds: string[]): Observable<SignUpResponse> {
    return this.http.post<SignUpResponse>(`${this.apiUrl}/${tourId}/signup`, { attendeeIds });
  }

  // Admin-only (see reservationController.js's updateAttendeeNights) - the
  // rare correction for someone leaving a night early. Not exposed to the
  // person registering; their nights are always set server-side at signup.
  updateAttendeeNights(
    tourId: string,
    reservationId: string,
    attendeeId: string,
    nights: number,
  ): Observable<{ status: string; data: { attendee: Attendee } }> {
    return this.http.patch<{ status: string; data: { attendee: Attendee } }>(
      `${this.apiUrl}/${tourId}/reservations/${reservationId}/attendees/${attendeeId}/nights`,
      { nights },
    );
  }

  getTourStats(): Observable<TourStatsResponse> {
    return this.http.get<TourStatsResponse>(`${this.apiUrl}/tour-stats`);
  }

  toggleScheduleParticipation(
    tourId: string,
    eventId: string,
  ): Observable<ToggleParticipationResponse> {
    return this.http.post<ToggleParticipationResponse>(
      `${this.apiUrl}/${tourId}/schedule/${eventId}/toggle-participation`,
      {},
    );
  }

  updateScheduleEvent(
    tourId: string,
    eventId: string,
    payload: UpdateScheduleEventPayload,
  ): Observable<UpdateScheduleEventResponse> {
    return this.http.patch<UpdateScheduleEventResponse>(
      `${this.apiUrl}/${tourId}/schedule/${eventId}`,
      payload,
    );
  }

  createScheduleEvent(
    tourId: string,
    payload: CreateScheduleEventPayload,
  ): Observable<CreateScheduleEventResponse> {
    return this.http.post<CreateScheduleEventResponse>(`${this.apiUrl}/${tourId}/schedule`, payload);
  }

  getTourImages(tourId: string): Observable<TourImagesResponse> {
    return this.http.get<TourImagesResponse>(`${this.apiUrl}/${tourId}/images`);
  }

  // Plain URLs, not Observables - these back <img>/<a> src/href attributes
  // directly. Auth rides on the session cookie (bodorgo.hu/api.bodorgo.hu
  // share a registrable domain, so it's same-site for cookie purposes even
  // though it's cross-origin - same reasoning imageCover already relies on).
  tourImageThumbUrl(tourId: string, filename: string): string {
    return `${this.apiUrl}/${tourId}/images/${encodeURIComponent(filename)}/thumb`;
  }

  tourImageFullUrl(tourId: string, filename: string): string {
    return `${this.apiUrl}/${tourId}/images/${encodeURIComponent(filename)}`;
  }

  tourImageDownloadUrl(tourId: string, filename: string): string {
    return `${this.apiUrl}/${tourId}/images/${encodeURIComponent(filename)}/download`;
  }

  tourImagesZipUrl(tourId: string): string {
    return `${this.apiUrl}/${tourId}/images/download-zip`;
  }

  // Admin-only server-side (restrictTo('admin') on the route) - marks/
  // unmarks one photo as restricted to that tour's own attendees.
  setImageRestricted(
    tourId: string,
    filename: string,
    restricted: boolean,
  ): Observable<{ status: string; data: { image: TourImage } }> {
    return this.http.patch<{ status: string; data: { image: TourImage } }>(
      `${this.apiUrl}/${tourId}/images/${encodeURIComponent(filename)}`,
      { restricted },
    );
  }

  // Tells the caller both whether they're even allowed to review this tour
  // (an actual attendee - see reviewController.js) and, if so, whatever
  // they've already rated it.
  getMyReview(tourId: string): Observable<MyReviewResponse> {
    return this.http.get<MyReviewResponse>(`${this.apiUrl}/${tourId}/reviews/me`);
  }

  // Submitting again just replaces this same person's earlier rating -
  // "change it any time", not a new entry each time.
  submitReview(tourId: string, rating: number): Observable<SubmitReviewResponse> {
    return this.http.put<SubmitReviewResponse>(`${this.apiUrl}/${tourId}/reviews`, { rating });
  }
}
