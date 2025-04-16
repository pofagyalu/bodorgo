import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  map,
  mergeMap,
  switchMap,
  of,
  filter,
  toArray,
  share,
  tap,
  throwError,
  catchError,
  retry,
} from 'rxjs';
import { NotificationsService } from '../notifications/notifications.service';

interface OpenWeatherResponse {
  list: {
    dt_txt: string;
    main: {
      temp: number;
    };
    weather: { main: string; icon: string }[];
  }[];
}

@Injectable({
  providedIn: 'root',
})
export class ForecastService {
  private url = 'https://api.openweathermap.org/data/2.5/forecast';

  constructor(
    private http: HttpClient,
    private notificationService: NotificationsService
  ) {}

  getForecast() {
    return this.getCurrentLocation().pipe(
      map((coords) => {
        return new HttpParams()
          .set('lat', String(coords.latitude))
          .set('lon', String(coords.longitude))
          .set('units', 'metric')
          .set('appid', environment.openWeatherApi);
      }),
      switchMap((params) =>
        this.http.get<OpenWeatherResponse>(this.url, { params })
      ),
      map((response) => response?.list),
      mergeMap((value) => of(...value)),
      filter((value) => new Date(value.dt_txt).getHours() === 15),
      map((value) => {
        return {
          dateString: value.dt_txt,
          temp: value.main.temp,
          weather: value.weather[0].main,
          icon: value.weather[0].icon,
        };
      }),
      toArray(),
      share()
    );
  }

  getCurrentLocation() {
    return new Observable<GeolocationCoordinates>((observer) => {
      window.navigator.geolocation.getCurrentPosition(
        (position) => {
          observer.next(position.coords);
          observer.complete();
        },
        (err) => {
          observer.error(err);
        }
      );
    }).pipe(
      retry(1),
      tap(() => {
        this.notificationService.addSuccess('Sikerült a helymeghatározás!');
      }),
      catchError((err) => {
        this.notificationService.addError('Nem sikerült a helymeghatározás!');
        return throwError(() => new Error(err));
      })
    );
  }
}
