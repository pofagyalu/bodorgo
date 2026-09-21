import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TourService, TourPayload } from '../../services/tour';
import { AuthService } from '../../auth/auth.service';
import { NotificationsService } from '../../notifications/notifications.service';

interface TourEditForm {
  order: number | null;
  title: string;
  placeName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  startDateLocal: string;
  duration: number | null;
  maxCapacity: number | null;
  summary: string;
  description: string;
  imageCover: string;
  // The accommodation payment breakdown shown on the tour-details
  // attendee list (Teljes ár/Foglaló/Maradék) - see
  // reservationController.js's computeAttendeePayments. All optional;
  // leaving them unset just means that breakdown isn't shown yet.
  accommodationPricePerNight: number | null;
  advancePaymentPercentage: number | null;
  clubSubsidyAmount: number | null;
}

function emptyForm(): TourEditForm {
  return {
    order: null,
    title: '',
    placeName: '',
    address: '',
    lat: null,
    lng: null,
    startDateLocal: '',
    duration: null,
    maxCapacity: null,
    summary: '',
    description: '',
    imageCover: '',
    accommodationPricePerNight: null,
    advancePaymentPercentage: null,
    // 0 ("no club money this time") is the common case, not an unusual
    // exception, so it starts filled in rather than blank.
    clubSubsidyAmount: 0,
  };
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not
// the UTC ISO string the API returns/expects.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Same form for editing an existing tour (route /taborok/:id/szerkesztes)
// and creating a brand new one (/taborok/uj, no :id) - see app.routes.ts.
// Admin-only; the guard is just an @if in the template since this app has
// no route-guard mechanism yet, matching profile.ts's own admin section.
@Component({
  selector: 'app-tour-edit',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './tour-edit.html',
  styleUrl: './tour-edit.scss',
})
export class TourEdit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);

  // The route param as-is (accepts either an id or a slug, same as
  // tour-details.ts) - null means create mode.
  tourId: string | null = null;
  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  form: TourEditForm = emptyForm();

  get isEditMode(): boolean {
    return this.tourId !== null;
  }

  // The club was founded in 2019, so it can't have contributed money
  // toward a tour that predates it - same cutoff as
  // reservationController.js's CLUB_FOUNDING_DATE, which also ignores
  // clubSubsidyAmount entirely for an old tour even if one somehow got
  // set on it. Disabled here (not just left at its 0 default) so there's
  // no chance of an admin entering a value that would silently never
  // apply.
  private static readonly CLUB_FOUNDING_DATE = new Date('2019-01-01T00:00:00.000Z');

  get subsidyAllowed(): boolean {
    if (!this.form.startDateLocal) return true; // no date chosen yet - don't block the field prematurely
    return new Date(this.form.startDateLocal) >= TourEdit.CLUB_FOUNDING_DATE;
  }

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return; // create mode - keep the empty form

    this.tourId = id;
    this.loading.set(true);

    this.tourService.getTour(id).subscribe({
      next: (res) => {
        const t = res.data.tour;
        this.form = {
          order: t.order,
          title: t.title,
          placeName: t.location.description,
          address: t.location.address,
          lat: t.location.coordinates[1] ?? null,
          lng: t.location.coordinates[0] ?? null,
          startDateLocal: toDatetimeLocal(t.startDate),
          duration: t.duration,
          maxCapacity: t.maxCapacity,
          summary: t.summary,
          description: t.description,
          imageCover: t.imageCover,
          accommodationPricePerNight: t.accommodationPricePerNight ?? null,
          advancePaymentPercentage: t.advancePaymentPercentage ?? null,
          clubSubsidyAmount: t.clubSubsidyAmount ?? 0,
        };
        this.loading.set(false);
      },
      error: () => {
        this.error.set('A tábor betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  save() {
    this.saving.set(true);
    this.error.set(null);

    const f = this.form;
    const payload: TourPayload = {
      order: f.order ?? undefined,
      title: f.title,
      location: {
        description: f.placeName,
        address: f.address,
        coordinates: f.lat != null && f.lng != null ? [f.lng, f.lat] : undefined,
      },
      startDate: f.startDateLocal ? new Date(f.startDateLocal).toISOString() : undefined,
      duration: f.duration ?? undefined,
      maxCapacity: f.maxCapacity ?? undefined,
      // price is never sent from this form at all - it's entirely
      // server-derived once accommodationPricePerNight is set (see
      // tourModel.js's pre('save') hook), and simply stays unset (shown
      // as "Nincs adat" on the tour card) until then.
      summary: f.summary,
      description: f.description,
      imageCover: f.imageCover,
      accommodationPricePerNight: f.accommodationPricePerNight ?? undefined,
      advancePaymentPercentage: f.advancePaymentPercentage ?? undefined,
      // Never sent for a pre-2019 tour, even if the disabled field
      // somehow still holds a stale nonzero value - the server ignores it
      // anyway (see reservationController.js's CLUB_FOUNDING_DATE), but
      // there's no reason to persist a misleading number either.
      clubSubsidyAmount: this.subsidyAllowed ? f.clubSubsidyAmount ?? undefined : 0,
    };

    const request = this.isEditMode
      ? this.tourService.updateTour(this.tourId!, payload)
      : this.tourService.createTour(payload);

    request.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.notifications.addSuccess(
          this.isEditMode ? 'Tábor mentése sikeres' : 'Tábor létrehozása sikeres',
        );
        this.router.navigate(['/taborok', res.data.tour.slug]);
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
        this.saving.set(false);
      },
    });
  }
}
