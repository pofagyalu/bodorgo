import { Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TourService, TourPayload, AccommodationHouse, OnSitePayment } from '../../services/tour';
import { PayMethodIcon, PayMethodKey } from '../../shared/pay-method-icon/pay-method-icon';
import { AuthService } from '../../auth/auth.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { environment } from '../../../environments/environment';
import { CropDialog } from '../../components/crop-dialog/crop-dialog';
import { AccommodationEditor } from './accommodation-editor/accommodation-editor';

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
  contact: string;
  panoramaUrl: string;
  panoramaTitle: string;
  summary: string;
  description: string;
  // The current (already uploaded) cover's URL, for the preview - '' if
  // there's none yet.
  existingCoverUrl: string;
  // The accommodation payment breakdown shown on the tour-details
  // attendee list (Teljes ár/Előleg/Fizetendő) - see
  // reservationController.js's computeAttendeePayments. All optional;
  // leaving them unset just means that breakdown isn't shown yet.
  // 'perHouse' (the default) treats accommodationPricePerNight as the
  // whole house's nightly rate; 'perPerson' treats it as the adult
  // per-person-per-night rate instead, with childPricePerNight/
  // childAgeLimitYears distinguishing a child discount - see
  // tourModel.js's own fields for the full reasoning.
  pricingMode: 'perHouse' | 'perPerson';
  accommodationPricePerNight: number | null;
  // Most accommodations are domestic HUF, but a foreign trip is sometimes
  // quoted in EUR by the venue - eurHufExchangeRate (the admin's own
  // manually-entered rate as of today) converts it, so the advertised
  // price and every attendee's billed amount still always end up in HUF
  // (see tourModel.js's toHuf). Only shown/required when this is 'EUR'.
  accommodationCurrency: 'HUF' | 'EUR';
  eurHufExchangeRate: number | null;
  childPricePerNight: number | null;
  childAgeLimitYears: number | null;
  advancePaymentPercentage: number | null;
  clubSubsidyAmount: number | null;
  // Fizetési módok: how the rest can be paid at the house.
  payment: OnSitePayment;
}

function emptyPayment(): OnSitePayment {
  return { cash: false, card: false, szep: false };
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
    contact: '',
    panoramaUrl: '',
    panoramaTitle: '',
    summary: '',
    description: '',
    existingCoverUrl: '',
    pricingMode: 'perHouse',
    accommodationPricePerNight: null,
    accommodationCurrency: 'HUF',
    eurHufExchangeRate: null,
    childPricePerNight: null,
    childAgeLimitYears: null,
    advancePaymentPercentage: null,
    // 0 ("no club money this time") is the common case, not an unusual
    // exception, so it starts filled in rather than blank.
    clubSubsidyAmount: 0,
    payment: emptyPayment(),
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
  imports: [FormsModule, RouterLink, CropDialog, AccommodationEditor, PayMethodIcon],
  templateUrl: './tour-edit.html',
  styleUrl: './tour-edit.scss',
})
export class TourEdit implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);
  environment = environment;

  // The route param as-is (accepts either an id or a slug, same as
  // tour-details.ts) - null means create mode.
  tourId: string | null = null;
  loading = signal(false);
  // The tour's saved Szállás, handed to the separately-saved
  // accommodation editor under the form (edit mode only).
  accommodationHouses = signal<AccommodationHouse[]>([]);
  saving = signal(false);
  error = signal<string | null>(null);
  form: TourEditForm = emptyForm();

  // --- Fizetési módok ---

  readonly payMethodOptions: { key: PayMethodKey; label: string }[] = [
    { key: 'cash', label: 'Készpénz' },
    { key: 'card', label: 'Bankkártya' },
    { key: 'szep', label: 'SZÉP kártya' },
  ];

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
    // A tour quoted in EUR gets no club subsidy (see computeAttendeePayments).
    if (this.form.accommodationCurrency === 'EUR') return false;
    if (!this.form.startDateLocal) return true; // no date chosen yet - don't block the field prematurely
    return new Date(this.form.startDateLocal) >= TourEdit.CLUB_FOUNDING_DATE;
  }

  // Why the subsidy field is off.
  get subsidyNote(): string {
    return this.form.accommodationCurrency === 'EUR'
      ? 'EUR-ban fizetett táborhoz a klub nem ad hozzájárulást.'
      : 'A klub 2019-ben alakult, ezért korábbi táborokhoz nem rendelhető hozzájárulás.';
  }

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return; // create mode - keep the empty form

    this.tourId = id;
    this.loading.set(true);

    this.tourService.getTour(id).subscribe({
      next: (res) => {
        const t = res.data.tour;
        this.accommodationHouses.set(t.accommodation?.houses ?? []);
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
          contact: t.contact ?? '',
          panoramaUrl: t.panoramaUrl ?? '',
          panoramaTitle: t.panoramaTitle ?? '',
          summary: t.summary,
          description: t.description,
          existingCoverUrl: this.tourService.coverUrl(t) ?? '',
          pricingMode: t.pricingMode ?? 'perHouse',
          accommodationPricePerNight: t.accommodationPricePerNight ?? null,
          accommodationCurrency: t.accommodationCurrency ?? 'HUF',
          eurHufExchangeRate: t.eurHufExchangeRate ?? null,
          childPricePerNight: t.childPricePerNight ?? null,
          childAgeLimitYears: t.childAgeLimitYears ?? null,
          advancePaymentPercentage: t.advancePaymentPercentage ?? null,
          clubSubsidyAmount: t.clubSubsidyAmount ?? 0,
          payment: t.onSitePayment ? { ...t.onSitePayment } : emptyPayment(),
        };
        this.loading.set(false);
      },
      error: () => {
        this.error.set('A tábor betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  // Cover image - any photo can be picked (straight from a phone/camera);
  // it goes through the shared crop dialog first, a fixed 3:2 frame the
  // admin positions/zooms, and only the result (a JPEG at most 1000x667,
  // i.e. twice the 500x333 the cards/tour page show it at, so it stays
  // sharp on high-density screens) is kept, and uploaded together with the
  // tour's own Mentés - for a new tour right after it's created, for an
  // existing one right after it's saved (see doSave() below). No separate
  // upload button: one of those was easy to miss, leaving a picked cover
  // silently unsaved.
  readonly coverAspectRatio = 3 / 2;
  readonly coverWidth = 1000;
  // The picked, not-yet-cropped file - while set, the crop dialog is open.
  coverToCrop = signal<File | null>(null);
  private selectedCoverFile: Blob | null = null;
  // A local, instant preview of whatever was just picked (before any
  // upload even starts) - revoked/replaced on every new selection so this
  // doesn't leak object URLs across picks.
  coverPreviewUrl = signal<string | null>(null);

  // Google Maps' own "copy coordinates" action puts "lat, lng" on the
  // clipboard as one string (e.g. "48.06859220246361, 20.63202028475125")
  // - pasting that as-is into a plain number input would just silently
  // fail (a comma isn't a valid number), so this intercepts the paste on
  // the lat field specifically and splits it into both fields at once
  // when it looks like a coordinate pair, falling back to the browser's
  // own default paste behavior otherwise (e.g. pasting just one number).
  onCoordinatePaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text') ?? '';
    const match = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return;

    event.preventDefault();
    this.form.lat = Number(match[1]);
    this.form.lng = Number(match[2]);
  }

  onCoverFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = ''; // picking the same file again should reopen the dialog
    if (file) this.coverToCrop.set(file);
  }

  onCoverCropFailed() {
    this.coverToCrop.set(null);
    this.notifications.addError('Ezt a képet nem sikerült megnyitni - válassz JPG vagy PNG képet.');
  }

  // The crop dialog's result becomes the cover to upload (and to preview).
  onCoverCropped(cover: Blob) {
    this.coverToCrop.set(null);
    this.selectedCoverFile = cover;

    const previous = this.coverPreviewUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.coverPreviewUrl.set(URL.createObjectURL(cover));
  }

  save() {
    this.error.set(null);
    this.saving.set(true);
    this.doSave();
  }

  private doSave() {
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
      contact: f.contact.trim(),
      panoramaUrl: f.panoramaUrl.trim(),
      panoramaTitle: f.panoramaTitle.trim(),
      // price is never sent from this form at all - it's entirely
      // server-derived once accommodationPricePerNight is set (see
      // tourModel.js's pre('save') hook), and simply stays unset (shown
      // as "Nincs adat" on the tour card) until then.
      summary: f.summary,
      description: f.description,
      pricingMode: f.pricingMode,
      accommodationPricePerNight: f.accommodationPricePerNight ?? undefined,
      accommodationCurrency: f.accommodationCurrency,
      // Only meaningful (and only shown/editable) while accommodationCurrency
      // is 'EUR' - omitted rather than cleared while it's 'HUF', so a rate
      // entered earlier survives toggling the currency back and forth
      // instead of having to be retyped, same reasoning as childPricePerNight
      // surviving a pricingMode toggle below.
      eurHufExchangeRate:
        f.accommodationCurrency === 'EUR' ? (f.eurHufExchangeRate ?? undefined) : undefined,
      // Only meaningful (and only shown/editable) in perPerson mode -
      // simply omitted while in perHouse mode rather than cleared, so a
      // value entered earlier survives toggling the mode back and forth
      // instead of having to be retyped.
      childPricePerNight:
        f.pricingMode === 'perPerson' ? (f.childPricePerNight ?? undefined) : undefined,
      childAgeLimitYears:
        f.pricingMode === 'perPerson' ? (f.childAgeLimitYears ?? undefined) : undefined,
      advancePaymentPercentage: f.advancePaymentPercentage ?? undefined,
      // Never sent for a pre-2019 tour, even if the disabled field
      // somehow still holds a stale nonzero value - the server ignores it
      // anyway (see reservationController.js's CLUB_FOUNDING_DATE), but
      // there's no reason to persist a misleading number either.
      clubSubsidyAmount: this.subsidyAllowed ? (f.clubSubsidyAmount ?? undefined) : 0,
      onSitePayment: f.payment,
    };

    const wasEditMode = this.isEditMode;
    const request = wasEditMode
      ? this.tourService.updateTour(this.tourId!, payload)
      : this.tourService.createTour(payload);

    request.subscribe({
      next: (res) => {
        this.notifications.addSuccess(
          wasEditMode ? 'Tábor mentése sikeres' : 'Tábor létrehozása sikeres',
        );
        // An edited tour goes to its own page; a brand new one always
        // returns to the list, whether or not a cover was picked (a
        // coverless creation used to stay on this form, which read as "did
        // this even save?").
        const leave = () => {
          this.saving.set(false);
          this.router.navigate(wasEditMode ? ['/taborok', res.data.tour.slug] : ['/taborok']);
        };
        if (!this.selectedCoverFile) {
          leave();
          return;
        }
        // A picked (cropped) cover is uploaded as part of saving, in both
        // modes - against the tour that was just created/saved. The tour
        // itself is already saved even if this upload fails, and the cover
        // can then be picked again from its edit page.
        this.tourService.uploadCoverImage(res.data.tour._id, this.selectedCoverFile).subscribe({
          next: leave,
          error: (err) => {
            this.notifications.addError(
              err?.error?.message ?? 'A tábor elmentve, de a borítókép feltöltése nem sikerült.',
            );
            leave();
          },
        });
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
        this.saving.set(false);
      },
    });
  }

  ngOnDestroy() {
    const previous = this.coverPreviewUrl();
    if (previous) URL.revokeObjectURL(previous);
  }
}
