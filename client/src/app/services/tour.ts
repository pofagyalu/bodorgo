import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CurrentUser } from '../auth/auth.service';

// A tour's accommodation (see tourModel.js's houseSchema/roomSchema).
// _id is absent only for a house/room just added in the editor and not
// saved yet - the server assigns one, and keeps it across later edits.
export interface AccommodationRoom {
  _id?: string;
  name: string;
  description: string;
  beds: number;
}

export interface AccommodationHouse {
  _id?: string;
  name: string;
  description: string;
  rooms: AccommodationRoom[];
}

export interface AccommodationResponse {
  status: string;
  data: { accommodation: { houses: AccommodationHouse[] } };
}

// One registered person on the Szobabeosztás board. attendeeId is their
// registration entry (what gets moved); roomId null = no room yet.
export interface RoomBoardPerson {
  attendeeId: string;
  userId: string | null;
  name: string;
  username: string | null;
  photoUpdatedAt: string | null;
  familyId: string | null;
  roomId: string | null;
}

export interface RoomBoardResponse {
  status: string;
  data: {
    houses: AccommodationHouse[];
    finalized: boolean;
    people: RoomBoardPerson[];
  };
}

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
  'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm';

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

// How the rest (Fizetendő) can be paid at the house (server
// utils/onSitePayment.js) - szep: SZÉP kártya.
export interface OnSitePayment {
  cash: boolean;
  card: boolean;
  szep: boolean;
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
  // Who to call on arrival (name, phone) - optional free text.
  contact?: string;
  // Lezárás: the tour is finished for good - nothing about it can be
  // changed any more, by anyone (the server refuses it; the pages hide
  // their edit controls). Set only by closeTour, never undone.
  closed?: boolean;
  closedAt?: string;
  // Link to the place's 360° panorama on another site - optional, and a
  // short name of where it was taken.
  panoramaUrl?: string;
  panoramaTitle?: string;
  // When the cover image last changed - absent until one is uploaded (see
  // tourCoverController.js). Also its cache-busting version (see
  // TourService.coverUrl).
  coverUpdatedAt?: string;
  images: string[];
  // Houses -> rooms -> places, set up by an admin (see tour-edit's
  // Szállás section). Absent/empty until then.
  accommodation?: { houses: AccommodationHouse[] };
  // Fizetési módok: how the rest can be paid at the house (unset until an
  // admin sets it on the tour edit form).
  onSitePayment?: OnSitePayment;
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
}

// A withdrawn registration ("Lemondás") - see cancellationModel.js.
export interface Cancellation {
  _id: string;
  name: string;
  bookedByName?: string;
  cancelledByName?: string;
  reason: string;
  wasPaid: boolean;
  cancelledAt: string;
}

// A letter an admin sent to a tour's attendees (see mailingController.js)
// - kept as the record of what went out.
export interface SentMailing {
  _id: string;
  subject: string;
  html: string;
  withPdf: boolean;
  sentAt: string;
  sentByName: string;
  recipientCount: number;
  skipped: { name: string; reason: string }[];
}

export interface MailingsResponse {
  status: string;
  data: {
    draft: { subject: string; html: string; delta: unknown; updatedAt: string } | null;
    sent: SentMailing[];
    recipients: { eligible: string[]; skipped: { name: string; reason: string }[] };
    defaults: { subject: string; withPdf: boolean };
  };
}

// A tour's beszámoló (server tourReportController.js). The header lines
// the admin can change - empty means the tour's own (auto).
export interface ReportFacts {
  place: string;
  dates: string;
  headcount: string;
}

// The admin's working copy: one editor content (Quill delta) per day, and
// the album photo at the top of the PDF.
export interface TourReport {
  status: 'draft' | 'final';
  days: (unknown | null)[];
  dayLabels: string[];
  facts: ReportFacts;
  auto: ReportFacts;
  photo: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  published: { at: string; byName: string } | null;
}

export interface ReportResponse {
  status: string;
  data: { canDownload: boolean; publishedAt: string | null; report?: TourReport };
}

// One version of a tour's recap video - matched to the tour by its file
// name on the NAS (see server/src/utils/tourVideos.js). Most tours have
// one with no label; a tour with two cuts has one per cut ("Directors
// Cut", "Kilians Cut").
export interface TourVideo {
  id: string;
  label: string;
  hasCover: boolean;
  hasSubtitles: boolean;
}

// A tour's Extrák document - one of the club's documents with this tour
// set (server documentController.js); opened by its id (documentUrl).
export interface ExtraDocument {
  _id: string;
  title: string;
  filename: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
}

// One attendee's accommodation share, computed server-side from the
// tour's accommodationPricePerNight/advancePaymentPercentage/
// clubSubsidyAmount (see reservationController.js's
// computeAttendeePayments) - never stored, so editing those tour fields
// recalculates every attendee immediately. totalPrice/advance/rest are
// all null when the tour has no pricing configured yet. totalPrice/rest
// are in the tour's accommodationCurrency (a EUR tour: whole euros, paid
// on site); advance is always the HUF that's paid to the club, and
// advanceInCurrency the same advance in the tour's currency. reservationId/
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
  advanceInCurrency: number | null;
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

// Same currencies as AttendeePayment's.
export interface PaymentTotals {
  totalPrice: number;
  advance: number;
  advanceInCurrency: number;
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
    // The recap video's versions, found by the tour number (see
    // tourController.js's getTour) - empty when there's none. The streams
    // are separate requireAuth-gated requests (see TourService.videoUrl).
    hasVideo: boolean;
    videos: TourVideo[];
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
  contact?: string;
  panoramaUrl?: string;
  panoramaTitle?: string;
  pricingMode?: 'perHouse' | 'perPerson';
  accommodationPricePerNight?: number;
  accommodationCurrency?: 'HUF' | 'EUR';
  eurHufExchangeRate?: number;
  childPricePerNight?: number;
  childAgeLimitYears?: number;
  advancePaymentPercentage?: number;
  clubSubsidyAmount?: number;
  onSitePayment?: OnSitePayment;
}

export interface SignUpResponse {
  status: string;
  data: {
    reservation: Reservation;
  };
}

// The Kotyogó's background - version changes with the image (the week, or
// an admin's "Másik háttér").
export interface ChatBackground {
  version: string;
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
  // 'mobile' = a phone photo (the tour folder's "mobil" subfolder) - shown
  // with a small phone icon; absent for the camera's photos.
  source?: 'mobile';
  takenAt?: string | null;
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
    hasEnded: boolean;
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

// The homepage's age chart (see tourController.js's attendeeAgeStats):
// the age is the one on the tour's first day; count is how many of the
// total attendees had a birthday on file, minAge-maxAge the youngest and
// oldest of them. A year's figures are over every such attendance of that
// year. Both lists come in time order.
export interface AgeFigures {
  averageAge: number;
  count: number;
  total: number;
  minAge: number;
  maxAge: number;
}

export interface AttendeeAges {
  tours: (AgeFigures & { title: string; order: number; slug: string; year: number })[];
  years: (AgeFigures & { year: number })[];
}

export interface TourStatsResponse {
  status: string;
  data: {
    // Only the tours that have already ended; upcomingTours = still ahead.
    totalTours: number;
    upcomingTours?: number;
    totalParticipants: number;
    // The gender split pooled across every tour attendee on record (not
    // every registered user - see tourController.js's getTourStats). null
    // until at least one attendee has a gender on file.
    genderRatio: { malePercentage: number; femalePercentage: number } | null;
    attendeeAges?: AttendeeAges;
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

  // Remembers the Tours page's choice of what to show ("all" or a year;
  // "" = not chosen yet: the latest year with a tour) across navigation -
  // the Tours component gets destroyed and
  // recreated every time you navigate back to it, wiping its own signals,
  // but this service is a singleton that lives for the app's session.
  toursPeriod = '';
  // ...and its order by date (true: oldest first), the same way.
  toursAscending = false;

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

  // Extrák documents go through the same /documents routes as the club's
  // own (server documentController.js). The file is a plain navigation -
  // the session cookie rides along.
  documentUrl(documentId: string): string {
    return `${environment.apiBaseUrl}/documents/${documentId}/file`;
  }

  // multipart/form-data, not JSON - HttpClient sets the right Content-Type
  // (with boundary) automatically when given a FormData body.
  uploadDocument(
    tourId: string,
    title: string,
    file: File,
  ): Observable<{
    data: {
      document: {
        _id: string;
        name: string;
        filename: string;
        mimeType: ExtraDocument['mimeType'];
      };
    };
  }> {
    const formData = new FormData();
    formData.append('name', title);
    formData.append('tour', tourId);
    formData.append('file', file);
    return this.http.post<{
      data: {
        document: {
          _id: string;
          name: string;
          filename: string;
          mimeType: ExtraDocument['mimeType'];
        };
      };
    }>(`${environment.apiBaseUrl}/documents`, formData);
  }

  deleteDocument(documentId: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/documents/${documentId}`);
  }

  // Sends the same PDF pdfUrl() downloads as an email attachment to the
  // logged-in requester's own address (no recipient picker yet).
  emailPdf(tourId: string): Observable<{ status: string; data: { sentTo: string } }> {
    return this.http.post<{ status: string; data: { sentTo: string } }>(
      `${this.apiUrl}/${tourId}/pdf/email`,
      {},
    );
  }

  // Admin-only: letters to the tour's attendees (see mailingController.js)
  // - the draft, the sent ones, and who'd receive the next.
  getMailings(tourId: string): Observable<MailingsResponse> {
    return this.http.get<MailingsResponse>(`${this.apiUrl}/${tourId}/mailings`);
  }

  saveMailDraft(tourId: string, draft: { subject: string; html: string; delta: unknown }) {
    return this.http.put<{ status: string; data: { updatedAt: string } }>(
      `${this.apiUrl}/${tourId}/mailings/draft`,
      draft,
    );
  }

  // --- Beszámoló (server tourReportController.js) ---

  // Whether I can download it; an admin also gets the working copy.
  getReport(tourId: string): Observable<ReportResponse> {
    return this.http.get<ReportResponse>(`${this.apiUrl}/${tourId}/report`);
  }

  saveReport(
    tourId: string,
    report: { days: unknown[]; facts: ReportFacts; photo: string | null },
  ) {
    return this.http.put<{ status: string; data: { updatedAt: string } }>(
      `${this.apiUrl}/${tourId}/report`,
      report,
    );
  }

  // Kész: the attendees can download it from now on.
  finishReport(tourId: string) {
    return this.http.post<{ status: string; data: { report: TourReport } }>(
      `${this.apiUrl}/${tourId}/report/finish`,
      {},
    );
  }

  // Visszanyitás: editable again (the attendees keep the finished one).
  reopenReport(tourId: string) {
    return this.http.post<{ status: string; data: { report: TourReport } }>(
      `${this.apiUrl}/${tourId}/report/reopen`,
      {},
    );
  }

  // The PDF - a plain download link; draft: the admin's preview of the
  // working copy (marked PISZKOZAT).
  reportPdfUrl(tourId: string, draft = false): string {
    return `${this.apiUrl}/${tourId}/report/pdf${draft ? '?draft=1' : ''}`;
  }

  // The saved draft to the admin themselves only.
  sendMailTest(tourId: string, withPdf: boolean) {
    return this.http.post<{ status: string; data: { sentTo: string } }>(
      `${this.apiUrl}/${tourId}/mailings/test`,
      {
        withPdf,
      },
    );
  }

  // The saved draft to every attendee who can get an e-mail - it then
  // becomes a sent letter, kept and no longer editable.
  sendMailing(tourId: string, withPdf: boolean) {
    return this.http.post<{ status: string; data: { mailing: SentMailing } }>(
      `${this.apiUrl}/${tourId}/mailings/send`,
      { withPdf },
    );
  }

  getTours(): Observable<ToursResponse> {
    return this.http.get<ToursResponse>(this.apiUrl);
  }

  /** The years that had a tour, oldest first */
  getTourYears() {
    return this.http.get<{ status: string; data: { years: number[] } }>(`${this.apiUrl}/years`);
  }

  /** One year's tours (by their first day) */
  getToursOfYear(year: number): Observable<ToursResponse> {
    return this.getToursWithParams({
      'startDate.gte': `${year}-01-01T00:00:00`,
      'startDate.lt': `${year + 1}-01-01T00:00:00`,
    });
  }

  /** Get the last 3 tours */
  getLast3Tours(): Observable<ToursResponse> {
    return this.http.get<ToursResponse>(`${this.apiUrl}/last-3`);
  }

  /** Optional: Get tours with query params (sorting/filtering/pagination) */
  getToursWithParams(params: Record<string, string | number | boolean>): Observable<ToursResponse> {
    return this.http.get<ToursResponse>(this.apiUrl, { params });
  }

  getTour(id: string): Observable<TourResponse> {
    return this.http.get<TourResponse>(`${this.apiUrl}/${id}`);
  }

  // Admin: Lezárás - one way only (see Tour.closed).
  closeTour(id: string): Observable<{ data: { closed: boolean; closedAt: string } }> {
    return this.http.post<{ data: { closed: boolean; closedAt: string } }>(
      `${this.apiUrl}/${id}/close`,
      {},
    );
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
  // Admin-only - replaces the tour's whole Szállás (houses -> rooms) in one
  // go, separately from the rest of the tour.
  updateAccommodation(
    tourId: string,
    houses: AccommodationHouse[],
  ): Observable<AccommodationResponse> {
    return this.http.put<AccommodationResponse>(`${this.apiUrl}/${tourId}/accommodation`, {
      houses,
    });
  }

  // Szobabeosztás - see roomAllocationController.js.
  getRoomBoard(tourId: string): Observable<RoomBoardResponse> {
    return this.http.get<RoomBoardResponse>(`${this.apiUrl}/${tourId}/rooms`);
  }

  // Admin-only. roomId null = take the person out of their room.
  assignRoom(tourId: string, attendeeId: string, roomId: string | null): Observable<unknown> {
    return this.http.put(`${this.apiUrl}/${tourId}/rooms/assignment`, { attendeeId, roomId });
  }

  // Admin-only.
  setRoomsFinalized(tourId: string, finalized: boolean): Observable<unknown> {
    return this.http.put(`${this.apiUrl}/${tourId}/rooms/finalized`, { finalized });
  }

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

  // "Lemondás" - takes one person off the tour (see
  // reservationController.js's withdrawAttendee for who may withdraw whom).
  withdrawAttendee(tourId: string, reservationId: string, attendeeId: string, reason: string) {
    return this.http.request<{
      status: string;
      data: { wasPaid: boolean; roomsReopened: boolean };
    }>('DELETE', `${this.apiUrl}/${tourId}/reservations/${reservationId}/attendees/${attendeeId}`, {
      body: { reason },
    });
  }

  // Admin-only - the tour's "Lemondások" list, newest first.
  getCancellations(tourId: string) {
    return this.http.get<{ status: string; data: { cancellations: Cancellation[] } }>(
      `${this.apiUrl}/${tourId}/cancellations`,
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
    return this.http.post<CreateScheduleEventResponse>(
      `${this.apiUrl}/${tourId}/schedule`,
      payload,
    );
  }

  getTourImages(tourId: string): Observable<TourImagesResponse> {
    return this.http.get<TourImagesResponse>(`${this.apiUrl}/${tourId}/images`);
  }

  // Plain URLs, not Observables - these back <img>/<a> src/href attributes
  // directly. Auth rides on the session cookie (bodorgo.hu/api.bodorgo.hu
  // share a registrable domain, so it's same-site for cookie purposes even
  // though it's cross-origin - same reasoning coverUrl above relies on).
  // The Kotyogó's background: this week's pale album photo, or null (see
  // server chat/chatBackground.js); an admin can pick another.
  getChatBackground(tourId: string) {
    return this.http.get<{ data: { background: ChatBackground | null } }>(
      `${this.apiUrl}/${tourId}/chat/background`,
    );
  }

  nextChatBackground(tourId: string) {
    return this.http.post<{ data: { background: ChatBackground } }>(
      `${this.apiUrl}/${tourId}/chat/background/next`,
      {},
    );
  }

  chatBackgroundUrl(tourId: string, background: ChatBackground): string {
    return `${this.apiUrl}/${tourId}/chat/background/image?v=${encodeURIComponent(background.version)}`;
  }

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
  // <video src>/<img src>/<track src> straight to the requireAuth-gated
  // routes (see tourVideoController.js), one video version each.
  videoUrl(tourId: string, videoId: string): string {
    return `${this.apiUrl}/${tourId}/videos/${videoId}/video`;
  }

  videoCoverUrl(tourId: string, videoId: string): string {
    return `${this.apiUrl}/${tourId}/videos/${videoId}/cover`;
  }

  subtitlesUrl(tourId: string, videoId: string): string {
    return `${this.apiUrl}/${tourId}/videos/${videoId}/subtitles.vtt`;
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
