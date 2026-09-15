import { Component, inject, signal, computed, effect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { TourService, Tour, ScheduleEntry, DailyWeather, WeatherCondition } from '../../services/tour';
import { UserService, FamilyMember, AdminUser } from '../../services/user';
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

// One selectable entry in the sign-up picker - a plain subset shared by
// FamilyMember, AdminUser and the logged-in user's own auth profile, all
// of which have _id + name but otherwise different shapes.
interface PickerOption {
  _id: string;
  name: string;
}

@Component({
  selector: 'app-tour-details',
  standalone: true,
  imports: [MatIconModule, RouterLink, TourEvent, EventForm],
  templateUrl: './tour-details.html',
  styleUrl: './tour-details.scss',
})
export class TourDetails {
  private route = inject(ActivatedRoute);
  private tourService = inject(TourService);
  private userService = inject(UserService);
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

  // Sign-up picker: who a 'member' or 'admin' can additionally choose to
  // register besides themselves - loaded once the role is known (see the
  // effect in the constructor, same pattern as profile.ts since
  // auth.user() resolves asynchronously). A 'guest' never needs either, so
  // both stay empty for them.
  familyMembers = signal<FamilyMember[]>([]);
  allUsers = signal<AdminUser[]>([]);
  private pickerDataRequested = false;
  selectedAttendeeIds = signal<Set<string>>(new Set());
  showAttendeePicker = signal(false);

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

  // Every user id already registered as an attendee (by anyone's
  // reservation) for this tour - drives both "have I signed up" and which
  // people the picker below should no longer offer.
  attendeeUserIds = computed<Set<string>>(() => {
    const t = this.tour();
    if (!t?.reservations) return new Set<string>();
    return new Set(t.reservations.flatMap((r) => r.attendees.map((a) => a.user)));
  });

  // Checks the actual attendee list, not just "did I book a reservation" -
  // a guest/member can also be registered by an admin acting on their
  // behalf, in which case they're an attendee without being the booker.
  alreadySignedUp = computed(() => {
    const uid = this.currentUserId();
    return !!uid && this.attendeeUserIds().has(uid);
  });

  // Who the logged-in user can still pick to register for this tour -
  // guest: just themselves (if not already registered); member: themselves
  // plus any not-yet-registered family member; admin: anyone at all not
  // yet registered. Mirrors reservationController.js's assertCanRegister,
  // purely so the picker doesn't offer choices the server would reject -
  // the server is still the actual source of truth for who's allowed.
  pickerOptions = computed<PickerOption[]>(() => {
    const user = this.auth.user();
    if (!user) return [];
    const already = this.attendeeUserIds();

    if (user.role === 'admin') {
      return this.allUsers()
        .filter((u) => !already.has(u._id))
        .map((u) => ({ _id: u._id, name: u.name }));
    }

    const options: PickerOption[] = [];
    if (user.name && !already.has(user.id)) {
      options.push({ _id: user.id, name: user.name });
    }
    if (user.role === 'member') {
      this.familyMembers()
        .filter((m) => !already.has(m._id))
        .forEach((m) => options.push({ _id: m._id, name: m.name }));
    }
    return options;
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

    // auth.user() often isn't resolved yet at construction time - see
    // profile.ts's constructor for the same reasoning. A 'guest' needs
    // neither request, so this only ever fires for 'member'/'admin'.
    effect(() => {
      const role = this.auth.user()?.role;
      if (!role || this.pickerDataRequested) return;
      this.pickerDataRequested = true;
      if (role === 'admin') {
        this.userService.getAllUsers().subscribe({
          next: (res) => this.allUsers.set(res.data.users),
        });
      } else if (role === 'member') {
        this.userService.getMyFamily().subscribe({
          next: (res) => this.familyMembers.set(res.data.members),
        });
      }
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

  // The simple one-click case: exactly one person to offer (a guest, or a
  // member/admin who has nobody else left to add) - no picker needed.
  signUpSingle() {
    const opt = this.pickerOptions()[0];
    if (opt) this.doSignUp([opt._id]);
  }

  openAttendeePicker() {
    this.signUpError.set(null);
    this.showAttendeePicker.set(true);
  }

  closeAttendeePicker() {
    this.showAttendeePicker.set(false);
    this.selectedAttendeeIds.set(new Set());
    this.signUpError.set(null);
  }

  isAttendeeSelected(id: string): boolean {
    return this.selectedAttendeeIds().has(id);
  }

  toggleAttendeeSelected(id: string) {
    this.selectedAttendeeIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  signUpSelected() {
    this.doSignUp([...this.selectedAttendeeIds()]);
  }

  private doSignUp(attendeeIds: string[]) {
    const t = this.tour();
    if (!t || attendeeIds.length === 0) return;

    this.signingUp.set(true);
    this.signUpError.set(null);

    this.tourService.signUp(t._id, attendeeIds).subscribe({
      next: (res) => {
        this.tour.update((cur) =>
          cur
            ? {
                ...cur,
                reservations: [...(cur.reservations ?? []), res.data.reservation],
              }
            : cur,
        );
        this.participantCount.update((n) => n + attendeeIds.length);
        this.selectedAttendeeIds.set(new Set());
        this.signingUp.set(false);
        // A successful submit always closes the picker - a no-op for the
        // single-click self/guest path, which never opens it in the first
        // place.
        this.showAttendeePicker.set(false);
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
