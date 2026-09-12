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

export interface Tour {
  order: number;
  title: string;
  location: {
    description: string;
    type: string;
    coordinates: number[];
    address: string;
  };
  coordinates: string;
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
}

@Injectable({
  providedIn: 'root',
})
export class TourService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/tours`;

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
}
