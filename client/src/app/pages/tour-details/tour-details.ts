import { Component, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { TourService, Tour, ScheduleEntry, DailyWeather, WeatherCondition } from '../../services/tour';
import { AuthService } from '../../auth/auth.service';
import { environment } from '../../../environments/environment';
import { randomLogoColor } from '../../shared/logo-colors';
import { TourEvent } from './tour-event/tour-event';
import { EventForm, EventFormModel } from './event-form/event-form';
import { NotificationsService } from '../../notifications/notifications.service';

interface DayGroup {
  day: number;
  label: string;
  events: ScheduleEntry[];
  weather?: DailyWeather;
}

interface AttendeeRow {
  name: string;
  paid: boolean;
}

@Component({
  selector: 'app-tour-details',
  standalone: true,
  imports: [MatIconModule, TourEvent, EventForm],
  templateUrl: './tour-details.html',
  styleUrl: './tour-details.scss',
})
export class TourDetails {
  private route = inject(ActivatedRoute);
  private tourService = inject(TourService);
  private sanitizer = inject(DomSanitizer);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);
  environment = environment;

  // Picked once per page view (not reactive - these don't need to change
  // while looking at the same tour), one independently random logo color
  // for each of the four info-line icons.
  placeIconColor = randomLogoColor();
  addressIconColor = randomLogoColor();
  distanceIconColor = randomLogoColor();
  dateIconColor = randomLogoColor();

  tour = signal<Tour | null>(null);
  participantCount = signal(0);
  loadError = signal<string | null>(null);
  signingUp = signal(false);
  signUpError = signal<string | null>(null);
  showMap = signal(false);
  showImage = signal(false);
  showParticipants = signal(false);
  // Which day (its 1-indexed number, or null for none) currently has the
  // "add new event" form open - only one at a time, same pattern as
  // tour-event.ts's own single-event edit mode.
  addingEventForDay = signal<number | null>(null);
  addingEvent = signal(false);
  addEventError = signal<string | null>(null);
  addEventForm: EventFormModel = { time: '08:00', description: '', isOptional: false, extraCost: null };
  // Starts as the "-full.webp" variant (derived by naming convention from
  // imageCover, e.g. tour-4-cover.webp -> tour-4-full.webp), falling back
  // to the regular thumbnail via (error) on the <img> if that file doesn't
  // exist yet for a given tour - see onPopupImageError().
  popupImageSrc = signal('');

  currentUserId = computed(() => this.auth.user()?.id);

  // Long Hungarian format ("2026. szeptember 12.") rather than Angular's
  // DatePipe, which needs hu locale data registered to avoid falling back
  // to English month names - this app doesn't register it (see the chat
  // feature's Post component for the same reasoning/pattern).
  formattedStartDate = computed(() => {
    const t = this.tour();
    if (!t) return '';
    return new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(t.startDate));
  });

  dayGroups = computed<DayGroup[]>(() => {
    const t = this.tour();
    if (!t) return [];

    const start = new Date(t.startDate);
    const dateFmt = new Intl.DateTimeFormat('hu-HU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const groups: DayGroup[] = [];
    for (let day = 1; day <= t.duration; day++) {
      const date = new Date(start);
      date.setDate(date.getDate() + (day - 1));

      const events = (t.schedule ?? [])
        .filter((e) => e.day === day)
        .slice()
        .sort((a, b) => a.time.localeCompare(b.time));

      const weather = t.dailyWeather?.find((w) => w.day === day);

      groups.push({ day, label: dateFmt.format(date), events, weather });
    }
    return groups;
  });

  private static readonly WEATHER_ICONS: Record<WeatherCondition, string> = {
    clear: 'clear.svg',
    'partly-cloudy': 'partly-cloudy.svg',
    cloudy: 'cloudy.svg',
    fog: 'fog.svg',
    rain: 'rain.svg',
    snow: 'snow.svg',
    thunderstorm: 'thunderstorm.svg',
  };

  weatherIconPath(condition: WeatherCondition): string {
    return `assets/images/weather/${TourDetails.WEATHER_ICONS[condition]}`;
  }

  allAttendees = computed<AttendeeRow[]>(() => {
    const t = this.tour();
    if (!t?.reservations) return [];
    return t.reservations
      .flatMap((r) => r.attendees.map((a) => ({ name: a.name, paid: r.paid })))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  });

  alreadySignedUp = computed(() => {
    const t = this.tour();
    const uid = this.currentUserId();
    if (!t?.reservations || !uid) return false;
    return t.reservations.some((r) => r.bookedBy?._id === uid);
  });

  isFull = computed(() => {
    const t = this.tour();
    if (!t) return false;
    return this.participantCount() >= t.maxCapacity;
  });

  // Embedding an iframe instead of opening a new tab/window keeps the user
  // on this page entirely - no popup-blocker risk either, unlike
  // window.open(). Angular sanitizes iframe src by default, hence bypass.
  mapEmbedUrl = computed<SafeResourceUrl | null>(() => {
    const t = this.tour();
    if (!t) return null;
    const [lng, lat] = t.location.coordinates;
    const url = `https://www.google.com/maps?q=${lat},${lng}&output=embed`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loadError.set('Hiányzó tábor azonosító.');
      return;
    }

    this.tourService.getTour(id).subscribe({
      next: (res) => {
        this.tour.set(res.data.tour);
        this.participantCount.set(res.data.participantCount);
        this.popupImageSrc.set(this.fullImageUrl(res.data.tour));
      },
      error: () => {
        this.loadError.set('A tábor nem található, vagy hiba történt a betöltés során.');
      },
    });
  }

  private fullImageUrl(t: Tour): string {
    const filename = t.imageCover.replace('-cover.webp', '-full.webp');
    return `${environment.assetUrl}/img/tours/${filename}`;
  }

  // The "-full" file doesn't exist yet for most tours (only new ones will
  // have one exported) - fall back to the regular thumbnail rather than
  // showing a broken image.
  onPopupImageError() {
    const t = this.tour();
    if (t) {
      this.popupImageSrc.set(`${environment.assetUrl}/img/tours/${t.imageCover}`);
    }
  }

  signUp() {
    const t = this.tour();
    if (!t) return;

    this.signingUp.set(true);
    this.signUpError.set(null);

    this.tourService.signUp(t._id).subscribe({
      next: (res) => {
        this.tour.update((cur) =>
          cur
            ? {
                ...cur,
                reservations: [...(cur.reservations ?? []), res.data.reservation],
              }
            : cur,
        );
        this.participantCount.update((n) => n + 1);
        this.signingUp.set(false);
      },
      error: (err) => {
        this.signUpError.set(
          err?.error?.message ?? 'Hiba történt a jelentkezés során.',
        );
        this.signingUp.set(false);
      },
    });
  }

  login() {
    this.auth.login();
  }

  openMap() {
    this.showMap.set(true);
  }

  closeMap() {
    this.showMap.set(false);
  }

  openImage() {
    this.showImage.set(true);
  }

  closeImage() {
    this.showImage.set(false);
  }

  // Called when a <app-tour-event> emits a fresh event after an opt-in
  // toggle or an admin edit - patches this one entry into the tour's own
  // schedule array immutably, which then flows back down to the same child
  // instance (matched by track ev._id) as its updated @Input().
  onEventUpdated(updated: ScheduleEntry) {
    this.tour.update((cur) => {
      if (!cur?.schedule) return cur;
      return {
        ...cur,
        schedule: cur.schedule.map((e) => (e._id === updated._id ? updated : e)),
      };
    });
  }

  startAddEvent(day: number) {
    this.addEventError.set(null);
    this.addEventForm = { time: '08:00', description: '', isOptional: false, extraCost: null };
    this.addingEventForDay.set(day);
  }

  cancelAddEvent() {
    this.addingEventForDay.set(null);
    this.addEventError.set(null);
  }

  saveNewEvent(day: number) {
    const t = this.tour();
    if (!t) return;

    this.addingEvent.set(true);
    this.addEventError.set(null);

    const form = this.addEventForm;
    this.tourService
      .createScheduleEvent(t._id, {
        day,
        time: form.time,
        description: form.description,
        isOptional: form.isOptional,
        extraCost: form.isOptional ? (form.extraCost ?? undefined) : undefined,
      })
      .subscribe({
        next: (res) => {
          this.tour.update((cur) =>
            cur ? { ...cur, schedule: [...(cur.schedule ?? []), res.data.event] } : cur,
          );
          this.addingEvent.set(false);
          this.addingEventForDay.set(null);
          this.notifications.addSuccess('Esemény mentése sikeres');
        },
        error: (err) => {
          this.addEventError.set(err?.error?.message ?? 'Hiba történt a hozzáadás során.');
          this.addingEvent.set(false);
        },
      });
  }
}
