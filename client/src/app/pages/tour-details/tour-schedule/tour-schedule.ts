import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  DailyWeather,
  ScheduleEntry,
  Tour,
  TourService,
  WeatherCondition,
} from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { EventForm, EventFormModel } from '../event-form/event-form';
import { ScheduleCandidate, TourEvent } from '../tour-event/tour-event';

interface DayGroup {
  day: number;
  label: string;
  events: ScheduleEntry[];
  weather?: DailyWeather;
}

// A tour's Programterv (tour-details): the day-by-day schedule, each day
// with its weather pill and its events (tour-event), plus the admin's "add
// event" form. Never changes the tour itself - an edited or a new event is
// handed back to the tour page (eventUpdated, eventAdded), which owns it.
@Component({
  selector: 'app-tour-schedule',
  imports: [MatIconModule, EventForm, TourEvent],
  templateUrl: './tour-schedule.html',
  styleUrl: './tour-schedule.scss',
})
export class TourSchedule {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  private auth = inject(AuthService);

  tour = input.required<Tour>();
  // Who the logged-in user can opt in/out of an optional event - see
  // tour-details.ts's myScheduleEventCandidates.
  candidates = input<ScheduleCandidate[]>([]);
  // { userId: photoUpdatedAt } and { userId: username } - passed on to each
  // event's avatars and chips (see tour-details.ts's userPhotos/usernames).
  userPhotos = input<Record<string, string>>({});
  usernames = input<Record<string, string>>({});
  eventUpdated = output<ScheduleEntry>();
  eventAdded = output<ScheduleEntry>();

  // An admin - and the tour not closed yet (Lezárás, see Tour.closed).
  canEdit = computed(() => this.auth.user()?.role === 'admin' && !this.tour().closed);

  // Which day (its 1-indexed number, or null for none) currently has the
  // "add new event" form open - only one at a time, same pattern as
  // tour-event.ts's own single-event edit mode.
  addingEventForDay = signal<number | null>(null);
  addingEvent = signal(false);
  addEventError = signal<string | null>(null);
  addEventForm: EventFormModel = {
    time: '08:00',
    description: '',
    isOptional: false,
    extraCost: null,
  };

  dayGroups = computed<DayGroup[]>(() => {
    const t = this.tour();

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
    return `assets/images/weather/${TourSchedule.WEATHER_ICONS[condition]}`;
  }

  // The weather pill's own tooltip (see tour-schedule.html) - used to just
  // say "Tényleges időjárás"/"Előrejelzés" (forecast vs. actual), which
  // never actually said what the weather itself was.
  private static readonly WEATHER_LABELS: Record<WeatherCondition, string> = {
    clear: 'Napos',
    'partly-cloudy': 'Változóan felhős',
    cloudy: 'Felhős',
    fog: 'Ködös',
    rain: 'Esős',
    snow: 'Havazás',
    thunderstorm: 'Zivataros',
  };

  weatherConditionLabel(condition: WeatherCondition): string {
    return TourSchedule.WEATHER_LABELS[condition];
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
    this.addingEvent.set(true);
    this.addEventError.set(null);

    const form = this.addEventForm;
    this.tourService
      .createScheduleEvent(this.tour()._id, {
        day,
        time: form.time,
        description: form.description,
        isOptional: form.isOptional,
        extraCost: form.isOptional ? (form.extraCost ?? undefined) : undefined,
      })
      .subscribe({
        next: (res) => {
          this.eventAdded.emit(res.data.event);
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
