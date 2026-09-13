import { Component, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { TourService, Tour, ScheduleEntry } from '../../services/tour';
import { AuthService } from '../../auth/auth.service';
import { environment } from '../../../environments/environment';
import { randomLogoColor } from '../../shared/logo-colors';

interface DayGroup {
  day: number;
  label: string;
  events: ScheduleEntry[];
}

interface AttendeeRow {
  name: string;
  paid: boolean;
}

@Component({
  selector: 'app-tour-details',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './tour-details.html',
  styleUrl: './tour-details.scss',
})
export class TourDetails {
  private route = inject(ActivatedRoute);
  private tourService = inject(TourService);
  private sanitizer = inject(DomSanitizer);
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
  // Which optional schedule events currently have their opted-in list
  // expanded - per-event, since a tour can have several optional events at
  // once, each independently collapsible.
  expandedEvents = signal<Set<string>>(new Set());
  togglingEventId = signal<string | null>(null);
  eventToggleError = signal<string | null>(null);
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

      groups.push({ day, label: dateFmt.format(date), events });
    }
    return groups;
  });

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

  isOptedIn(event: ScheduleEntry): boolean {
    const uid = this.currentUserId();
    if (!uid) return false;
    return (event.participants ?? []).some((p) => p.user === uid);
  }

  isEventExpanded(eventId: string): boolean {
    return this.expandedEvents().has(eventId);
  }

  toggleEventExpanded(eventId: string) {
    this.expandedEvents.update((set) => {
      const next = new Set(set);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  toggleEventOptIn(event: ScheduleEntry) {
    const t = this.tour();
    if (!t) return;

    this.togglingEventId.set(event._id);
    this.eventToggleError.set(null);

    this.tourService.toggleScheduleParticipation(t._id, event._id).subscribe({
      next: (res) => {
        this.tour.update((cur) => {
          if (!cur?.schedule) return cur;
          return {
            ...cur,
            schedule: cur.schedule.map((e) =>
              e._id === event._id ? { ...e, participants: res.data.participants } : e,
            ),
          };
        });
        this.togglingEventId.set(null);
      },
      error: (err) => {
        this.eventToggleError.set(
          err?.error?.message ?? 'Hiba történt a jelentkezés módosítása során.',
        );
        this.togglingEventId.set(null);
      },
    });
  }
}
