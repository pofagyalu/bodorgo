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

export interface ScheduleEntry {
  _id: string;
  day: number;
  time: string;
  description: string;
}

export interface Attendee {
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
  reservations?: Reservation[];
}

export interface TourResponse {
  status: string;
  data: {
    tour: Tour;
    participantCount: number;
  };
}

export interface SignUpResponse {
  status: string;
  data: {
    reservation: Reservation;
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

  signUp(tourId: string): Observable<SignUpResponse> {
    return this.http.post<SignUpResponse>(`${this.apiUrl}/${tourId}/signup`, {});
  }

  getTourStats(): Observable<TourStatsResponse> {
    return this.http.get<TourStatsResponse>(`${this.apiUrl}/tour-stats`);
  }
}
