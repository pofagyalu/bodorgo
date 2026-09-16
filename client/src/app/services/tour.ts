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
  price: number;
  summary: string;
  description: string;
  imageCover: string;
  images: string[];
  // Only populated on the single-tour endpoint (getTour), not the list one.
  schedule?: ScheduleEntry[];
  dailyWeather?: DailyWeather[];
  reservations?: Reservation[];
}

export interface TourResponse {
  status: string;
  data: {
    tour: Tour;
    participantCount: number;
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
}

export interface SignUpResponse {
  status: string;
  data: {
    reservation: Reservation;
  };
}

// width/height are what PhotoSwipe needs upfront for every slide to size
// and zoom correctly; size (bytes) drives the "download all" zip button's
// total-size tooltip - see tourImageController.js.
export interface TourImage {
  filename: string;
  width: number;
  height: number;
  size: number;
}

export interface TourImagesResponse {
  status: string;
  data: {
    images: TourImage[];
  };
}

export interface TourStatsResponse {
  status: string;
  data: {
    totalTours: number;
    totalParticipants: number;
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
}
