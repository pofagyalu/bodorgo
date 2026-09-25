import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CurrentUser } from '../auth/auth.service';

export interface TickerResponse {
  status: string;
  data: {
    label: 'Következő' | 'Legutóbbi';
    order: number;
    title: string;
    place: string;
    startDate: string;
  } | null;
}

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

export interface UpdateScheduleEventParticipantsResponse {
  status: string;
  data: {
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
  // A bare id fresh off signUp()'s own response (Reservation.create()
  // doesn't populate anything), but a populated object once loaded via
  // getTour (attendees.user is populated there for computeAttendeePayments
  // - see tourController.js) - genuinely both shapes in practice, since a
  // freshly-appended reservation (see tour-details.ts's doSignUp) sits
  // alongside getTour-loaded ones in the same reservations array until
  // the page is reloaded. Use attendeeUserId() below rather than reading
  // this directly.
  user: string | { _id: string; role?: string; birthday?: string; familyId?: string };
  name: string;
}

// See Attendee.user's own comment on why this can't just be read directly.
export function attendeeUserId(attendee: Attendee): string {
  return typeof attendee.user === 'string' ? attendee.user : attendee.user._id;
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
  // Raw, Budapest-specific cache computed server-side at tour save time
  // (see tourModel.js) - NOT what should be shown to a viewer directly,
  // since it's only the fallback for someone with no home address of
  // their own. Use TourResponse's own distanceInfo for display instead,
  // which already picks the right one.
  distanceFromBudapestKm?: number;
  drivingDurationFromBudapestMinutes?: number;
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
  // When the cover image last changed - absent until one is uploaded (see
  // tourCoverController.js). Also its cache-busting version (see
  // TourService.coverUrl).
  coverUpdatedAt?: string;
  images: string[];
  // Only populated on the single-tour endpoint (getTour), not the list one.
  schedule?: ScheduleEntry[];
  dailyWeather?: DailyWeather[];
  reservations?: Reservation[];
  // The inputs behind each attendee's accommodation breakdown (see
  // AttendeePayment below) - all optional, a tour with none of these set
  // simply has no payment breakdown to show yet. 'perHouse' (the default)
  // means accommodationPricePerNight is the whole house's nightly rate;
  // 'perPerson' means it's the adult per-person-per-night rate instead,
  // with childPricePerNight/childAgeLimitYears distinguishing a child
  // discount - see tourModel.js's own fields for the full reasoning.
  pricingMode?: 'perHouse' | 'perPerson';
  accommodationPricePerNight?: number;
  // Which currency accommodationPricePerNight/childPricePerNight are
  // quoted in - defaults to 'HUF' server-side. Everything actually shown
  // to a non-admin (the advertised price, each attendee's billed amount)
  // is still always converted to and shown in HUF (see tourModel.js's
  // toHuf) - this only matters for the admin edit form itself.
  accommodationCurrency?: 'HUF' | 'EUR';
  // Only meaningful when accommodationCurrency is 'EUR' - the admin's own
  // manually-entered EUR->HUF rate used for that conversion.
  eurHufExchangeRate?: number;
  childPricePerNight?: number;
  childAgeLimitYears?: number;
  advancePaymentPercentage?: number;
  clubSubsidyAmount?: number;
  // Admin-uploaded extras shown in the "Extra infók" section (a map, a
  // beszámoló, places-to-visit notes, etc.) - only populated on the
  // single-tour endpoint, same as schedule/reservations above.
  extraDocuments?: ExtraDocument[];
  // The raw NAS-relative video path - only ever present in getTour's
  // response for an admin viewer (see tourController.js), used solely to
  // pre-select the current choice in tour-edit.ts's video picker. Never
  // rely on this for playback - use TourService.videoUrl instead.
  videoFile?: string;
}

// filename is what's actually on disk under
// server/public/documents/tours/<tourId>/ (see TourService.documentUrl) -
// never the original upload name.
export interface ExtraDocument {
  _id: string;
  title: string;
  filename: string;
  mimeType: 'application/pdf' | 'image/jpeg';
  uploadedAt: string;
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
  // Lets the attendee list group/stripe by family (see attendee-list.ts)
  // - null for someone with no family on record at all.
  familyId: string | null;
  // The linked User's own id (distinct from attendeeId, this attendee
  // *subdocument's* own id) - lets the advance-payment page identify "is
  // this row literally me", which familyId alone can't do for someone
  // with no family on record.
  userId: string | null;
  // This specific person's own paid status (see reservationModel.js's
  // attendeeSchema.paid) - not the whole reservation's, since a family
  // reservation can have some members paid and others not.
  paid: boolean;
  // Admin-only override (see reservationModel.js's own comment) - an
  // infant, a last-minute free guest, a comped invitee. Still a normal
  // attendee (counted toward capacity/nights), just excluded from
  // totalPrice/advance/rest below, which are always 0 when this is true.
  feeExempt: boolean;
  totalPrice: number | null;
  advance: number | null;
  rest: number | null;
  // Which real Payment (if any) backs this attendee - null when paid is
  // false, or when it's true with nothing real behind it (legacy data,
  // the 0%-advance auto-mark). Lets the admin attendee-list tell a
  // genuine cash entry (safely undoable - see payment.ts's
  // deleteCashPayment) apart from a real Stripe payment (never touchable
  // here) or an untracked historical paid flag.
  paymentId: string | null;
  paymentMethod: 'stripe' | 'cash' | null;
}

// Whether this attendee row is the given logged-in user themselves, or
// shares their family - the one rule behind both the tour-details page's
// "Előleg befizetés" button (only shown when there's actually someone
// left in the group with an unpaid advance) and the payment page's own
// attendee list, kept in exactly one place so the two can't drift apart.
export function isInMyPaymentGroup(payment: AttendeePayment, me: CurrentUser | null): boolean {
  if (!me) return false;
  return payment.userId === me.id || (!!me.familyId && payment.familyId === me.familyId);
}

export interface PaymentTotals {
  totalPrice: number;
  advance: number;
  rest: number;
}

// Distance/duration/wording for the info-line's directions_car row -
// personalized to the logged-in viewer's own geocoded home address when
// they have one (see userModel.js's address/location fields), otherwise
// the tour's own cached figures from Budapest. Always use this instead of
// Tour's own distanceFromBudapestKm/drivingDurationFromBudapestMinutes
// for display - those two are the raw Budapest-specific cache the server
// falls back to, not what should actually be shown to this viewer.
export interface DistanceInfo {
  distanceKm: number | null;
  durationMinutes: number | null;
  fromLabel: string;
}

export interface TourResponse {
  status: string;
  data: {
    tour: Tour;
    // Derived server-side from the admin-only videoFile field (never sent
    // to the client directly - see tourController.js's getTour) - whether
    // to show the recap video player at all. The actual stream is a
    // separate requireAuth-gated request (see TourService.videoUrl).
    hasVideo: boolean;
    participantCount: number;
    attendeePayments: AttendeePayment[];
    paymentTotals: PaymentTotals | null;
    distanceInfo: DistanceInfo;
    // { userId: photoUpdatedAt } for everyone shown on the page (attendees,
    // program sign-ups) who has a profile photo - see tourController.js.
    userPhotos: Record<string, string>;
    // { userId: username } for those of them who've set one - shown
    // instead of the full name on the program sign-up chips.
    usernames: Record<string, string>;
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
  pricingMode?: 'perHouse' | 'perPerson';
  accommodationPricePerNight?: number;
  accommodationCurrency?: 'HUF' | 'EUR';
  eurHufExchangeRate?: number;
  childPricePerNight?: number;
  childAgeLimitYears?: number;
  advancePaymentPercentage?: number;
  clubSubsidyAmount?: number;
  // Relative path under the NAS video library, picked from
  // TourService.getAvailableVideos() rather than typed by hand (see
  // tourVideoController.js's listAvailableVideos) - an empty string clears
  // it, same convention as familyId elsewhere.
  videoFile?: string;
}

export interface AvailableVideosResponse {
  status: string;
  data: { files: string[] };
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

  // Same reasoning, for the tour-details page's "Résztvevők" expand/
  // collapse toggle - remembers whether it was last left open, instead of
  // always resetting to collapsed when navigating back to a tour.
  showParticipantsPreference = false;

  // A plain GET URL, not an HttpClient call - the browser navigates/
  // downloads directly (see tour-details.html's <a [href]>), same as any
  // other file download; the server sets Content-Disposition so it saves
  // rather than navigates. Requires being logged in (the session cookie
  // rides along automatically) - each copy is stamped with the
  // downloader's own name in the footer (see tourPdfController.js), so
  // tour-details.html only shows the download button when logged in.
  pdfUrl(tourId: string): string {
    return `${this.apiUrl}/${tourId}/pdf`;
  }

  // Admin-only (see tourExcelController.js's downloadAttendeesExcel) - a
  // real spreadsheet meant to be handed to the house owner: every
  // attendee's price/advance/rest/paid status, grouped by family with an
  // emphasized subtotal row per family, built from the exact same numbers
  // the attendee list itself shows. A plain GET URL, not an HttpClient
  // call, same as pdfUrl above.
  attendeesExcelUrl(tourId: string): string {
    return `${this.apiUrl}/${tourId}/attendees/export.xlsx`;
  }

  // A plain static file URL, same as tour cover images - see
  // tourDocumentController.js's comment on why these aren't served
  // through a requireAuth-gated route.
  documentUrl(tourId: string, filename: string): string {
    return `${environment.assetUrl}/documents/tours/${tourId}/${filename}`;
  }

  // multipart/form-data, not JSON - HttpClient sets the right Content-Type
  // (with boundary) automatically when given a FormData body.
  uploadDocument(tourId: string, title: string, file: File): Observable<TourResponse> {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('file', file);
    return this.http.post<TourResponse>(`${this.apiUrl}/${tourId}/documents`, formData);
  }

  deleteDocument(tourId: string, documentId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${tourId}/documents/${documentId}`);
  }

  // Sends the same PDF pdfUrl() downloads as an email attachment to the
  // logged-in requester's own address (no recipient picker yet).
  emailPdf(tourId: string): Observable<{ status: string; data: { sentTo: string } }> {
    return this.http.post<{ status: string; data: { sentTo: string } }>(
      `${this.apiUrl}/${tourId}/pdf/email`,
      {},
    );
  }

  // Admin-only: emails the Programfüzet to every eligible attendee of this
  // tour (has an email, has logged in at least once, hasn't opted out) -
  // see tourPdfController.js's partitionAttendeesByEmailEligibility.
  emailPdfToAttendees(tourId: string): Observable<{
    status: string;
    data: { sentCount: number; sentTo: string[]; skipped: { name: string; reason: string }[] };
  }> {
    return this.http.post<{
      status: string;
      data: { sentCount: number; sentTo: string[]; skipped: { name: string; reason: string }[] };
    }>(`${this.apiUrl}/${tourId}/pdf/email-attendees`, {});
  }

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

  // The cover image, served only to a logged-in browser (the session
  // cookie goes along with the <img> request - bodorgo.hu and
  // api.bodorgo.hu are the same site). ?v= changes with every new upload,
  // so the old one can be cached forever. null = no cover yet.
  coverUrl(tour: { _id: string; coverUpdatedAt?: string }): string | null {
    return tour.coverUpdatedAt
      ? `${this.apiUrl}/${tour._id}/cover?v=${encodeURIComponent(tour.coverUpdatedAt)}`
      : null;
  }

  // Sets/replaces a tour's cover - the JPEG the crop dialog already
  // produced in the browser (3:2, at most 1000x667 - see tour-edit.ts).
  uploadCoverImage(tourId: string, cover: Blob): Observable<TourResponse> {
    const formData = new FormData();
    formData.append('file', cover, 'cover.jpg');
    return this.http.post<TourResponse>(`${this.apiUrl}/${tourId}/cover`, formData);
  }

  // The landing page ticker's one line - the only tour data available
  // without logging in (see tourController.js's getTicker).
  getTicker(): Observable<TickerResponse> {
    return this.http.get<TickerResponse>(`${this.apiUrl}/ticker`);
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

  // Admin-only (see reservationController.js's updateAttendeeFeeExempt) -
  // the real but rare case where a specific attendee owes nothing at all
  // (an infant, a last-minute free guest, a comped invitee), regardless
  // of the tour's own pricing formula.
  updateAttendeeFeeExempt(
    tourId: string,
    reservationId: string,
    attendeeId: string,
    feeExempt: boolean,
  ): Observable<{ status: string; data: { attendee: Attendee } }> {
    return this.http.patch<{ status: string; data: { attendee: Attendee } }>(
      `${this.apiUrl}/${tourId}/reservations/${reservationId}/attendees/${attendeeId}/fee-exempt`,
      { feeExempt },
    );
  }

  getTourStats(): Observable<TourStatsResponse> {
    return this.http.get<TourStatsResponse>(`${this.apiUrl}/tour-stats`);
  }

  // Replaces exactly the caller's own editable subset of participants
  // (self + family for a member/guest, anyone actually attending for an
  // admin - see tourController.js's updateScheduleEventParticipants) -
  // not a simple self-toggle, so a family can cherry-pick which specific
  // members join (e.g. only the kids for a kids' breakfast).
  updateScheduleEventParticipants(
    tourId: string,
    eventId: string,
    userIds: string[],
  ): Observable<UpdateScheduleEventParticipantsResponse> {
    return this.http.patch<UpdateScheduleEventParticipantsResponse>(
      `${this.apiUrl}/${tourId}/schedule/${eventId}/participants`,
      { userIds },
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
  // though it's cross-origin - same reasoning coverUrl above relies on).
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

  // Same plain-URL-with-cookie-auth pattern as the image URLs above - a
  // <video src> straight to the requireAuth-gated stream (see
  // tourVideoController.js's getTourVideo).
  videoUrl(tourId: string): string {
    return `${this.apiUrl}/${tourId}/video`;
  }

  // A <track src> - 404s silently (no subtitle track rendered) when the
  // video has no matching .srt file, which is the normal case for most
  // episodes (see tourVideoController.js's getTourSubtitles).
  subtitlesUrl(tourId: string): string {
    return `${this.apiUrl}/${tourId}/subtitles.vtt`;
  }

  // Admin-only - the real files found under the NAS video library, for the
  // tour-edit page's video picker.
  getAvailableVideos(): Observable<AvailableVideosResponse> {
    return this.http.get<AvailableVideosResponse>(`${this.apiUrl}/videos/available`);
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
