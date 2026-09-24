import { Component, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import type PhotoSwipeLightbox from 'photoswipe/lightbox';
import {
  TourService,
  Tour,
  ScheduleEntry,
  DailyWeather,
  WeatherCondition,
  TourImage,
  AttendeePayment,
  PaymentTotals,
  DistanceInfo,
  ExtraDocument,
  attendeeUserId,
  isInMyPaymentGroup,
} from '../../services/tour';
import { UserService, FamilyMember, AdminUser } from '../../services/user';
import { AuthService } from '../../auth/auth.service';
import { environment } from '../../../environments/environment';
import { shuffledLogoColors } from '../../shared/logo-colors';
import { formatDrivingDuration } from '../../shared/format';
import { TourEvent } from './tour-event/tour-event';
import { EventForm, EventFormModel } from './event-form/event-form';
import { ReviewStars } from './review-stars/review-stars';
import { AttendeeList, AttendeeListRow as AttendeeListPayment } from './attendee-list/attendee-list';
import { NotificationsService } from '../../notifications/notifications.service';

interface DayGroup {
  day: number;
  label: string;
  events: ScheduleEntry[];
  weather?: DailyWeather;
}

// AttendeePayment (from the API) plus the whole-reservation `paid` flag -
// a different, pre-existing concept ("has an admin marked this
// reservation as settled") from the newly computed per-person amounts, so
// it's merged in here rather than folded into computeAttendeePayments.
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
  imports: [MatIconModule, RouterLink, FormsModule, TourEvent, EventForm, ReviewStars, AttendeeList],
  templateUrl: './tour-details.html',
  styleUrl: './tour-details.scss',
})
export class TourDetails implements OnDestroy {
  private route = inject(ActivatedRoute);
  private tourService = inject(TourService);
  private userService = inject(UserService);
  private sanitizer = inject(DomSanitizer);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);
  environment = environment;
  readonly formatDrivingDuration = formatDrivingDuration;

  // Picked once per page view (not reactive - these don't need to change
  // while looking at the same tour), one per icon off a shuffled copy of
  // the logo colors so none of the four can repeat.
  private readonly infoLineIconColors = shuffledLogoColors();
  placeIconColor = this.infoLineIconColors[0];
  addressIconColor = this.infoLineIconColors[1];
  distanceIconColor = this.infoLineIconColors[2];
  dateIconColor = this.infoLineIconColors[3];

  private tourId!: string;
  tour = signal<Tour | null>(null);
  participantCount = signal(0);
  // Each attendee's accommodation breakdown, computed server-side (see
  // getTour/computeAttendeePayments) - reloaded in full (not patched
  // locally) after an admin edits one attendee's nights, since re-fetching
  // is simple and this is a rare admin action, not a hot path.
  attendeePayments = signal<AttendeePayment[]>([]);
  paymentTotals = signal<PaymentTotals | null>(null);
  distanceInfo = signal<DistanceInfo | null>(null);
  // Whether an admin has assigned a post-tour recap video (see
  // tourController.js's getTour) - the actual file path never reaches the
  // client, just this boolean plus the requireAuth-gated stream URL below.
  hasVideo = signal(false);
  loadError = signal<string | null>(null);
  signingUp = signal(false);
  signUpError = signal<string | null>(null);
  showMap = signal(false);
  // Restores whatever expand/collapse choice was last made (see
  // tour.ts's showParticipantsPreference), instead of always resetting to
  // collapsed when navigating back to a tour.
  showParticipants = signal(this.tourService.showParticipantsPreference);
  // Which day (its 1-indexed number, or null for none) currently has the
  // "add new event" form open - only one at a time, same pattern as
  // tour-event.ts's own single-event edit mode.
  addingEventForDay = signal<number | null>(null);
  addingEvent = signal(false);
  addEventError = signal<string | null>(null);
  addEventForm: EventFormModel = { time: '08:00', description: '', isOptional: false, extraCost: null };

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

  // Gallery (see tour-photos-implementation-plan.md) - only ever fetched
  // for a logged-in viewer (the route is requireAuth-gated server-side
  // anyway), so an anonymous visitor never triggers a guaranteed 401.
  // Deliberately not shown as a thumbnail grid on the page itself (that
  // was the first attempt, dropped per feedback) - clicking the cover
  // photo is the only entry point, everything else happens inside the
  // opened PhotoSwipe viewer (see initLightbox()).
  tourImages = signal<TourImage[]>([]);
  private imagesRequested = false;
  private lightbox: PhotoSwipeLightbox | null = null;

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

  // How much each attendee owes across every optional, extra-cost
  // schedule event they joined (e.g. picking "Reggeli felnőtt" on both
  // Friday and Saturday sums both occurrences) - purely informational
  // (see attendee-list.ts's own optionalProgramsCost column), since these
  // are always settled on-site in person, never through this app.
  // Matched by userId (the linked account), not attendeeId (this
  // reservation's own attendee subdocument id) - schedule participants
  // are recorded per User, same person can be an attendee via different
  // reservations across tours but always the same User underneath.
  private optionalProgramsCostByUserId = computed<Map<string, number>>(() => {
    const schedule = this.tour()?.schedule ?? [];
    const costs = new Map<string, number>();
    for (const event of schedule) {
      if (!event.isOptional || !event.extraCost) continue;
      for (const p of event.participants ?? []) {
        costs.set(p.user, (costs.get(p.user) ?? 0) + event.extraCost);
      }
    }
    return costs;
  });

  // paid comes straight from the API now (see AttendeePayment's own
  // comment) - this specific person's own status, not the whole
  // reservation's, so no merging needed here beyond the display sort and
  // folding in each person's own optional-programs total above.
  allAttendees = computed<AttendeeListPayment[]>(() => {
    if (!this.tour()?.reservations) return [];
    const programCosts = this.optionalProgramsCostByUserId();
    return [...this.attendeePayments()]
      .map((p) => ({ ...p, optionalProgramsCost: (p.userId && programCosts.get(p.userId)) || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  });

  // Every user id already registered as an attendee (by anyone's
  // reservation) for this tour - drives both "have I signed up" and which
  // people the picker below should no longer offer.
  attendeeUserIds = computed<Set<string>>(() => {
    const t = this.tour();
    if (!t?.reservations) return new Set<string>();
    return new Set(t.reservations.flatMap((r) => r.attendees.map((a) => attendeeUserId(a))));
  });

  // Checks the actual attendee list, not just "did I book a reservation" -
  // a guest/member can also be registered by an admin acting on their
  // behalf, in which case they're an attendee without being the booker.
  alreadySignedUp = computed(() => {
    const uid = this.currentUserId();
    return !!uid && this.attendeeUserIds().has(uid);
  });

  // Whether there's anyone left in my own payment group (self + family)
  // who still has an unpaid advance - if everyone's already settled up,
  // the "Előleg befizetés" button would just lead to an empty, useless
  // page, so it's hidden entirely rather than shown pointlessly. Same
  // isInMyPaymentGroup rule the payment page itself uses to build its own
  // list, so the two can never disagree about who's included.
  hasUnpaidAdvanceInMyGroup = computed(() => {
    const me = this.auth.user();
    return this.attendeePayments().some((p) => p.advance != null && !p.paid && isInMyPaymentGroup(p, me));
  });

  // Someone an admin marked "retired" (member-edit.ts) - attended in the
  // past, kept for history everywhere, just never offered again as a
  // candidate for a new reservation or schedule-event opt-in (below).
  retiredUserIds = computed<Set<string>>(
    () => new Set(this.allUsers().filter((u) => u.retired).map((u) => u._id)),
  );

  // Who the logged-in user can still pick to register for this tour -
  // guest: just themselves (if not already registered); member: themselves
  // plus any not-yet-registered family member; admin: anyone at all not
  // yet registered (and not retired). Mirrors reservationController.js's
  // assertCanRegister, purely so the picker doesn't offer choices the
  // server would reject - the server is still the actual source of truth
  // for who's allowed.
  pickerOptions = computed<PickerOption[]>(() => {
    const user = this.auth.user();
    if (!user) return [];
    const already = this.attendeeUserIds();

    if (user.role === 'admin') {
      const retired = this.retiredUserIds();
      return this.allUsers()
        .filter((u) => !already.has(u._id) && !retired.has(u._id))
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

  // Who the logged-in user can opt in/out of an optional schedule event
  // (e.g. a kids' breakfast) - only ever people actually attending this
  // tour, since opting in someone who isn't even coming makes no sense.
  // Admin: every real attendee except a retired one (see retiredUserIds
  // above - they may well be a real historical attendee of this exact
  // tour, but an admin still shouldn't be offered them going forward);
  // anyone else: just their own payment group (self + same familyId), same
  // rule the payment page itself uses - mirrors
  // updateScheduleEventParticipants' own server-side check.
  myScheduleEventCandidates = computed<PickerOption[]>(() => {
    const me = this.auth.user();
    if (!me) return [];
    const attendees = this.allAttendees().filter((a) => a.userId);
    const pool =
      me.role === 'admin'
        ? attendees.filter((a) => !this.retiredUserIds().has(a.userId!))
        : attendees.filter((a) => isInMyPaymentGroup(a, me));
    return pool.map((a) => ({ _id: a.userId!, name: a.name }));
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
    this.tourId = id;
    this.loadTour(id);

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

    // Same "wait for both pieces of async state" pattern as the picker
    // effect above - fires once the tour is loaded AND login status is
    // known to be true, never for an anonymous visitor. Once the images
    // arrive, initLightbox() sets up the (DOM-independent, see below)
    // PhotoSwipe instance once - openCoverGallery() only ever opens it.
    effect(() => {
      const t = this.tour();
      const loggedIn = this.auth.isLoggedIn();
      if (!t || !loggedIn || this.imagesRequested) return;
      this.imagesRequested = true;
      this.tourService.getTourImages(t._id).subscribe({
        next: (res) => {
          this.tourImages.set(res.data.images);
          if (res.data.images.length > 0) this.initLightbox();
        },
      });
    });
  }

  // Extracted out of the constructor so the attendee list's nights-edit
  // action (admin-only) can trigger a full reload after saving - simplest
  // way to get every attendee's recomputed totals back in sync, and rare
  // enough (an occasional admin correction) that refetching everything
  // instead of patching one row locally is not a real cost.
  private loadTour(id: string) {
    this.tourService.getTour(id).subscribe({
      next: (res) => {
        this.tour.set(res.data.tour);
        this.participantCount.set(res.data.participantCount);
        this.attendeePayments.set(res.data.attendeePayments);
        this.paymentTotals.set(res.data.paymentTotals);
        this.distanceInfo.set(res.data.distanceInfo);
        this.hasVideo.set(res.data.hasVideo);
      },
      error: () => {
        this.loadError.set('A tábor nem található, vagy hiba történt a betöltés során.');
      },
    });
  }

  onAttendeeNightsUpdated() {
    this.loadTour(this.tourId);
  }

  toggleParticipants() {
    const next = !this.showParticipants();
    this.showParticipants.set(next);
    this.tourService.showParticipantsPreference = next;
  }

  pdfUrl(tourId: string): string {
    return this.tourService.pdfUrl(tourId);
  }

  attendeesExcelUrl(tourId: string): string {
    return this.tourService.attendeesExcelUrl(tourId);
  }

  videoUrl(tourId: string): string {
    return this.tourService.videoUrl(tourId);
  }

  subtitlesUrl(tourId: string): string {
    return this.tourService.subtitlesUrl(tourId);
  }

  // Same deep-link URLs as tourPdfController.js's Helyszín row - each
  // app handles the handoff itself (installed app on mobile, its own web
  // app on desktop), nothing platform-specific to detect here.
  wazeUrl(t: Tour): string {
    const [lng, lat] = t.location.coordinates;
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }

  googleMapsUrl(t: Tour): string {
    const [lng, lat] = t.location.coordinates;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }

  // Extra infók - admin-only upload/delete of the handful of documents
  // (map, beszámoló, places-to-visit notes) shown alongside the always-
  // present Programfüzet card.
  addingDocument = signal(false);
  uploadingDocument = signal(false);
  newDocumentTitle = '';
  private selectedDocumentFile: File | null = null;

  documentUrl(tourId: string, filename: string): string {
    return this.tourService.documentUrl(tourId, filename);
  }

  // v1 test of the "send Programfüzet by email" card - sends to the
  // logged-in user's own address, no recipient picker yet.
  emailingPdf = signal(false);

  sendPdfByEmail(tourId: string) {
    if (this.emailingPdf()) return;
    this.emailingPdf.set(true);
    this.tourService.emailPdf(tourId).subscribe({
      next: (res) => {
        this.emailingPdf.set(false);
        this.notifications.addSuccess(`Programfüzet elküldve: ${res.data.sentTo}`);
      },
      error: (err) => {
        this.emailingPdf.set(false);
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a küldés során.');
      },
    });
  }

  // Admin-only: emails the Programfüzet to every eligible attendee - a
  // real send to potentially several real people, so it's gated behind an
  // explicit confirm modal (same reasoning as the document-delete one
  // above), not a one-click fire.
  confirmingEmailAttendees = signal(false);
  emailingAttendees = signal(false);

  askEmailAttendees() {
    this.confirmingEmailAttendees.set(true);
  }

  cancelEmailAttendees() {
    this.confirmingEmailAttendees.set(false);
  }

  confirmEmailAttendees(tourId: string) {
    this.emailingAttendees.set(true);
    this.tourService.emailPdfToAttendees(tourId).subscribe({
      next: (res) => {
        this.emailingAttendees.set(false);
        this.confirmingEmailAttendees.set(false);
        const { sentCount, skipped } = res.data;
        this.notifications.addSuccess(`Programfüzet elküldve ${sentCount} résztvevőnek.`);
        if (skipped.length > 0) {
          this.notifications.addError(
            `${skipped.length} résztvevő kimaradt: ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}`,
          );
        }
      },
      error: (err) => {
        this.emailingAttendees.set(false);
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a küldés során.');
      },
    });
  }

  startAddDocument() {
    this.newDocumentTitle = '';
    this.selectedDocumentFile = null;
    this.addingDocument.set(true);
  }

  cancelAddDocument() {
    this.addingDocument.set(false);
  }

  onDocumentFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedDocumentFile = input.files?.[0] ?? null;
  }

  saveNewDocument(tourId: string) {
    const title = this.newDocumentTitle.trim();
    if (!title) {
      this.notifications.addError('A dokumentumnak kell legyen címe.');
      return;
    }
    if (!this.selectedDocumentFile) {
      this.notifications.addError('Válassz ki egy PDF vagy JPG fájlt.');
      return;
    }

    this.uploadingDocument.set(true);
    this.tourService.uploadDocument(tourId, title, this.selectedDocumentFile).subscribe({
      next: (res) => {
        this.uploadingDocument.set(false);
        this.addingDocument.set(false);
        this.tour.set(res.data.tour);
        this.notifications.addSuccess('Dokumentum feltöltve');
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a feltöltés során.');
        this.uploadingDocument.set(false);
      },
    });
  }

  // A real in-app modal (reusing the attendee-picker's backdrop/box visual
  // language) rather than the browser's own confirm() - not just for
  // looks, the native dialog also can't be styled/translated consistently
  // with the rest of the page.
  documentPendingDelete = signal<ExtraDocument | null>(null);
  deletingDocument = signal(false);

  askDeleteDocument(doc: ExtraDocument, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.documentPendingDelete.set(doc);
  }

  cancelDeleteDocument() {
    this.documentPendingDelete.set(null);
  }

  confirmDeleteDocument(tourId: string) {
    const doc = this.documentPendingDelete();
    if (!doc) return;

    this.deletingDocument.set(true);
    this.tourService.deleteDocument(tourId, doc._id).subscribe({
      next: () => {
        const t = this.tour();
        if (t) {
          this.tour.set({ ...t, extraDocuments: (t.extraDocuments ?? []).filter((d) => d._id !== doc._id) });
        }
        this.deletingDocument.set(false);
        this.documentPendingDelete.set(null);
        this.notifications.addSuccess('Dokumentum törölve');
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a törlés során.');
        this.deletingDocument.set(false);
      },
    });
  }

  // No on-page thumbnail grid (dropped per feedback - too much clutter),
  // so there's no DOM gallery for PhotoSwipeLightbox to scan; every open
  // instead passes an explicit dataSource built from tourImages() (see
  // openCoverGallery()), and the two custom toolbar buttons below + the
  // bottom filmstrip are the only way to browse once it's open.
  private async initLightbox() {
    const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
    this.lightbox = new PhotoSwipeLightbox({
      pswpModule: () => import('photoswipe'),
    });

    this.lightbox.on('uiRegister', () => {
      const ui = this.lightbox!.pswp!.ui!;

      // Admin-only: mark/unmark the currently-viewed photo as restricted
      // to that tour's own attendees (see
      // tourImageController.js's canViewRestrictedImages) - for the rare
      // sensitive photo, set by hand after upload. Only registered at all
      // for an admin viewer; toggling patches tourImages() locally so the
      // icon and any later re-open reflect the new state without
      // reloading the whole gallery.
      if (this.auth.user()?.role === 'admin') {
        ui.registerElement({
          name: 'restrict-button',
          order: 7,
          isButton: true,
          html: {
            isCustomSVG: true,
            size: 24,
            inner:
              '<path d="M12 17a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2m6-9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1V6a5 5 0 0 1 10 0v2h-2V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v2z" id="pswp__icn-restrict"/>',
            outlineID: 'pswp__icn-restrict',
          },
          onInit: (el, pswp) => {
            const refresh = () => {
              const img = this.tourImages()[pswp.currIndex];
              el.title = img?.restricted
                ? 'Csak a résztvevők látják - kattints a feloldáshoz'
                : 'Mindenki látja - kattints a résztvevőkre korlátozáshoz';
              el.classList.toggle('pswp__button--restrict-active', !!img?.restricted);
            };
            pswp.on('change', refresh);
            refresh();

            el.addEventListener('click', () => {
              const img = this.tourImages()[pswp.currIndex];
              if (img) this.toggleImageRestricted(img.filename, !img.restricted, refresh);
            });
          },
        });
      }

      // Download button, next to zoom/close - see
      // https://photoswipe.com/adding-ui-elements/. Points at the
      // dedicated /download route (sets Content-Disposition: attachment)
      // rather than the plain display URL - a bare <a download> is
      // silently ignored by the browser for a cross-origin URL (client and
      // API are on different subdomains), same reasoning as
      // documentController.js's own download route elsewhere in this app.
      ui.registerElement({
        name: 'download-button',
        order: 8,
        isButton: true,
        tagName: 'a',
        title: 'Fénykép letöltése',
        html: {
          isCustomSVG: true,
          size: 24,
          inner: '<path d="M12 16l-6-6h4V4h4v6h4l-6 6zM5 18h14v2H5z" id="pswp__icn-download"/>',
          outlineID: 'pswp__icn-download',
        },
        onInit: (el, pswp) => {
          const link = el as HTMLAnchorElement;
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener');
          pswp.on('change', () => {
            const img = this.tourImages()[pswp.currIndex];
            link.href = img ? this.galleryDownloadUrl(img.filename) : '';
          });
        },
      });

      // Second button - the whole gallery as a zip, same download-forcing
      // reasoning as above. Static href/title (doesn't depend on the
      // current slide), set once.
      ui.registerElement({
        name: 'download-all-button',
        order: 9,
        isButton: true,
        tagName: 'a',
        html: {
          isCustomSVG: true,
          size: 24,
          inner:
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16h-2v2h-2v-2h-2v-2h2v-2h2v2h2v2z" id="pswp__icn-download-all"/>',
          outlineID: 'pswp__icn-download-all',
        },
        onInit: (el) => {
          const link = el as HTMLAnchorElement;
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener');
          link.href = this.galleryZipUrl();
          const totalBytes = this.tourImages().reduce((sum, img) => sum + img.size, 0);
          // Native title tooltips render a literal \n as a line break.
          link.title = `Összes kép letöltése\n(zip, kb. ${this.formatBytes(totalBytes)})`;
        },
      });

      // Bottom filmstrip - click any thumbnail to jump straight to it, or
      // use PhotoSwipe's own built-in arrows/swipe to advance one by one.
      // Lives in PhotoSwipe's own root overlay (outside Angular's view
      // entirely, appended straight to <body>), so it's built with plain
      // DOM APIs rather than a template - styled globally in styles.scss
      // since a component-scoped stylesheet could never reach it anyway.
      ui.registerElement({
        name: 'thumbnails-strip',
        appendTo: 'root',
        onInit: (el, pswp) => {
          el.className = 'pswp__thumbnails-strip';
          const thumbEls = this.tourImages().map((img, i) => {
            const thumb = document.createElement('img');
            thumb.src = this.galleryThumbUrl(img.filename);
            thumb.loading = 'lazy';
            thumb.className = 'pswp__thumbnails-strip-item';
            thumb.addEventListener('click', () => pswp.goTo(i));
            el.appendChild(thumb);
            return thumb;
          });

          const setActive = () => {
            thumbEls.forEach((thumb, i) => {
              thumb.classList.toggle('pswp__thumbnails-strip-item--active', i === pswp.currIndex);
            });
            thumbEls[pswp.currIndex]?.scrollIntoView({ inline: 'center', block: 'nearest' });
          };
          pswp.on('change', setActive);
          pswp.on('afterInit', setActive);
        },
      });
    });

    this.lightbox.init();
  }

  ngOnDestroy() {
    this.lightbox?.destroy();
  }

  // Clicking the cover image opens the gallery at its first photo, rather
  // than the old separate single-image popup - the cover is just the
  // tours-list thumbnail, the gallery is the actual photo collection now
  // that one exists. A no-op if the gallery hasn't loaded (or doesn't
  // exist) yet for this tour, rather than erroring.
  openCoverGallery() {
    const images = this.tourImages();
    if (images.length === 0 || !this.lightbox) return;
    this.lightbox.loadAndOpen(
      0,
      images.map((img) => ({
        src: this.galleryFullUrl(img.filename),
        width: img.width,
        height: img.height,
        alt: img.filename,
      })),
    );
  }

  private toggleImageRestricted(filename: string, restricted: boolean, onDone: () => void) {
    const t = this.tour();
    if (!t) return;

    this.tourService.setImageRestricted(t._id, filename, restricted).subscribe({
      next: () => {
        this.tourImages.update((imgs) =>
          imgs.map((img) => (img.filename === filename ? { ...img, restricted } : img)),
        );
        onDone();
        this.notifications.addSuccess(
          restricted ? 'Fénykép korlátozva a résztvevőkre' : 'Fénykép újra mindenki számára látható',
        );
      },
      error: (err) => {
        this.notifications.addError(
          err?.error?.message ?? 'Hiba történt a korlátozás módosítása közben.',
        );
      },
    });
  }

  // Only used from initLightbox()/openCoverGallery() now - there's no
  // on-page gallery template binding these into anymore.
  private galleryThumbUrl(filename: string): string {
    const t = this.tour();
    return t ? this.tourService.tourImageThumbUrl(t._id, filename) : '';
  }

  private galleryFullUrl(filename: string): string {
    const t = this.tour();
    return t ? this.tourService.tourImageFullUrl(t._id, filename) : '';
  }

  private galleryDownloadUrl(filename: string): string {
    const t = this.tour();
    return t ? this.tourService.tourImageDownloadUrl(t._id, filename) : '';
  }

  private galleryZipUrl(): string {
    const t = this.tour();
    return t ? this.tourService.tourImagesZipUrl(t._id) : '';
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
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

  // Called when <app-review-stars> emits after a successful submit - keeps
  // the compact average shown near the top in sync immediately, without
  // reloading the whole tour.
  onReviewSubmitted(result: { average: number; quantity: number }) {
    this.tour.update((cur) =>
      cur ? { ...cur, ratingsAverage: result.average, ratingsQuantity: result.quantity } : cur,
    );
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
