import {
  Component,
  HostListener,
  inject,
  signal,
  computed,
  effect,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { GalleryPhoto, PhotoGalleryService } from '../../shared/photo-gallery';
import {
  TourService,
  Tour,
  ScheduleEntry,
  TourImage,
  AttendeePayment,
  PaymentTotals,
  DistanceInfo,
  ExtraDocument,
  TourVideo,
  attendeeUserId,
  isInMyPaymentGroup,
} from '../../services/tour';
import { UserService, FamilyMember, AdminUser } from '../../services/user';
import { AuthService } from '../../auth/auth.service';
import { environment } from '../../../environments/environment';
import { shuffledLogoColors } from '../../shared/logo-colors';
import { formatDrivingDuration } from '../../shared/format';
import { CalendarEvent, downloadIcs, googleCalendarUrl } from '../../shared/calendar-event';
import { TourSchedule } from './tour-schedule/tour-schedule';
import { ReviewStars } from './review-stars/review-stars';
import { VideoCard } from '../../shared/video-card/video-card';
import { VideoPlayer } from '../../shared/video-player/video-player';
import { PickerOption, TourSignup } from './tour-signup/tour-signup';
import { TourExtras } from './tour-extras/tour-extras';
import {
  AttendeeList,
  AttendeeListRow as AttendeeListPayment,
} from './attendee-list/attendee-list';
import { NotificationsService } from '../../notifications/notifications.service';

@Component({
  selector: 'app-tour-details',
  standalone: true,
  imports: [
    MatIconModule,
    RouterLink,
    TourSchedule,
    ReviewStars,
    AttendeeList,
    VideoCard,
    VideoPlayer,
    TourSignup,
    TourExtras,
  ],
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
  readonly formatDrivingDuration = formatDrivingDuration;

  // So onSignedUp below can tell it to re-check "am I an attendee now" right
  // after a successful sign-up - review-stars.ts only ever checks that
  // once on its own (ngOnInit), and none of its @Inputs change value just
  // because the viewer signed up, so nothing would otherwise trigger a
  // re-check short of a full page reload.
  @ViewChild(ReviewStars) reviewStars?: ReviewStars;

  // Picked once per page view (not reactive - these don't need to change
  // while looking at the same tour), one per icon off a shuffled copy of
  // the logo colors so none of them can repeat. Orange is left out: it's
  // the review star's fixed color right above them (review-stars.scss).
  private readonly infoLineIconColors = shuffledLogoColors().filter(
    (c) => c !== 'var(--logo-orange)',
  );
  placeIconColor = this.infoLineIconColors[0];
  addressIconColor = this.infoLineIconColors[1];
  distanceIconColor = this.infoLineIconColors[2];
  dateIconColor = this.infoLineIconColors[3];
  contactIconColor = this.infoLineIconColors[4];

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
  // Profile photo versions of everyone on this page (attendee list, program
  // sign-ups) - passed down to their avatars.
  userPhotos = signal<Record<string, string>>({});
  usernames = signal<Record<string, string>>({});
  // The recap video's versions, found on the NAS by the tour number (see
  // tourController.js's getTour) - usually one. playingVideo is the one
  // open in the player dialog.
  videos = signal<TourVideo[]>([]);
  playingVideo = signal<TourVideo | null>(null);
  loadError = signal<string | null>(null);
  showMap = signal(false);
  // Restores whatever expand/collapse choice was last made (see
  // tour.ts's showParticipantsPreference), instead of always resetting to
  // collapsed when navigating back to a tour.
  showParticipants = signal(this.tourService.showParticipantsPreference);
  // Sign-up (tour-signup): who a 'member' or 'admin' can additionally choose to
  // register besides themselves - loaded once the role is known (see the
  // effect in the constructor, same pattern as profile.ts since
  // auth.user() resolves asynchronously). A 'guest' never needs either, so
  // both stay empty for them.
  familyMembers = signal<FamilyMember[]>([]);
  allUsers = signal<AdminUser[]>([]);
  private pickerDataRequested = false;

  // Gallery (see tour-photos-implementation-plan.md) - only ever fetched
  // for a logged-in viewer (the route is requireAuth-gated server-side
  // anyway), so an anonymous visitor never triggers a guaranteed 401.
  // Deliberately not shown as a thumbnail grid on the page itself (that
  // was the first attempt, dropped per feedback) - clicking the cover
  // photo is the only entry point, everything else happens in the app's
  // shared photo viewer (shared/photo-gallery).
  tourImages = signal<TourImage[]>([]);
  private imagesRequested = false;
  private gallery = inject(PhotoGalleryService);

  currentUserId = computed(() => this.auth.user()?.id);

  // An admin may edit the tour - until it's closed (Lezárás, see
  // Tour.closed): then nobody, and every edit control on the page goes.
  canEdit = computed(() => this.auth.user()?.role === 'admin' && !this.tour()?.closed);

  // The padlock's tooltip on a closed tour.
  closedLabel = computed(() => {
    const at = this.tour()?.closedAt;
    const day = at
      ? new Intl.DateTimeFormat('hu-HU', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(new Date(at))
      : '';
    return `Lezárt tábor${day ? ` (${day})` : ''} – már nem módosítható`;
  });

  // Extrák (tour-extras) closed the tour.
  onTourClosed(closedAt: string) {
    this.tour.update((t) => (t ? { ...t, closed: true, closedAt } : t));
  }

  // Hungarian format with the short month ("2026. szept. 12." - so the
  // line fits on a phone) rather than Angular's
  // DatePipe, which needs hu locale data registered to avoid falling back
  // to English month names - this app doesn't register it (see the chat
  // feature's Post component for the same reasoning/pattern).
  formattedStartDate = computed(() => {
    const t = this.tour();
    if (!t) return '';
    return new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(t.startDate));
  });

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
    // The programs' prices are in HUF; on a EUR tour the list shows them in
    // EUR like the rest (the tour's rate, rounded up to whole euros).
    const t = this.tour();
    const inTourCurrency = (huf: number) =>
      t?.accommodationCurrency === 'EUR' && t.eurHufExchangeRate
        ? Math.ceil(huf / t.eurHufExchangeRate)
        : huf;
    return [...this.attendeePayments()]
      .map((p) => ({
        ...p,
        optionalProgramsCost: inTourCurrency((p.userId && programCosts.get(p.userId)) || 0),
      }))
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
    return this.attendeePayments().some(
      (p) => p.advance != null && !p.paid && isInMyPaymentGroup(p, me),
    );
  });

  // Someone an admin marked "retired" (member-edit.ts) - attended in the
  // past, kept for history everywhere, just never offered again as a
  // candidate for a new reservation or schedule-event opt-in (below).
  retiredUserIds = computed<Set<string>>(
    () =>
      new Set(
        this.allUsers()
          .filter((u) => u.retired)
          .map((u) => u._id),
      ),
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
    // A closed tour: nobody opts in or out any more.
    if (!me || this.tour()?.closed) return [];
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

  // Sign-up closes when the tour starts - except for an admin, who can
  // still register people afterwards (backfilling past tours). The server
  // enforces the same (reservationController.js's signUpForTour).
  signUpOpen = computed(() => {
    const t = this.tour();
    if (!t) return false;
    return this.auth.user()?.role === 'admin' || new Date() < new Date(t.startDate);
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

  // The place's 360° panorama (the tour's panoramaUrl, on another site) in
  // a popup like the map's - null without a usable http(s) link, and then
  // the cover's 360° badge isn't shown either.
  showPanorama = signal(false);
  // "360°-os panoráma: Poprádi-tó" - the badge's tooltip and the popup's
  // caption; without a title just "360°-os panoráma".
  panoramaLabel = computed(() => {
    const title = this.tour()?.panoramaTitle?.trim();
    return title ? `360°-os panoráma: ${title}` : '360°-os panoráma';
  });
  panoramaEmbedUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.tour()?.panoramaUrl?.trim();
    if (!url || !/^https?:\/\//i.test(url)) return null;
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
    // known to be true, never for an anonymous visitor.
    effect(() => {
      const t = this.tour();
      const loggedIn = this.auth.isLoggedIn();
      if (!t || !loggedIn || this.imagesRequested) return;
      this.imagesRequested = true;
      this.tourService.getTourImages(t._id).subscribe({
        next: (res) => {
          this.tourImages.set(res.data.images);
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
        this.videos.set(res.data.videos ?? []);
        this.userPhotos.set(res.data.userPhotos ?? {});
        this.usernames.set(res.data.usernames ?? {});
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

  attendeesExcelUrl(tourId: string): string {
    return this.tourService.attendeesExcelUrl(tourId);
  }

  // Same deep-link URLs as tourPdfController.js's Helyszín row - each
  // app handles the handoff itself (installed app on mobile, its own web
  // app on desktop), nothing platform-specific to detect here.
  // The Kapcsolat line's text split around phone numbers, so each number
  // becomes a tap-to-call link (e.g. "Kiss Béla, +36 30 123 4567").
  contactParts(contact: string): { text: string; tel?: string }[] {
    const phone = /(\+?\d[\d\s/()-]{5,}\d)/;
    return contact
      .split(phone)
      .filter(Boolean)
      .map((text) =>
        phone.test(text) && text.match(phone)![0] === text
          ? { text, tel: text.replace(/[^\d+]/g, '') }
          : { text },
      );
  }

  // --- Mentés a naptárba: the calendar icon's menu (Google Calendar, or an
  // .ics file for Apple Calendar / Outlook - see shared/calendar-event.ts).

  showCalendarMenu = signal(false);

  toggleCalendarMenu(event: Event) {
    event.stopPropagation();
    this.showCalendarMenu.update((open) => !open);
  }

  @HostListener('document:click')
  closeCalendarMenu() {
    this.showCalendarMenu.set(false);
  }

  private calendarEvent(t: Tour): CalendarEvent {
    const start = new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Budapest',
    }).format(new Date(t.startDate));
    const place = [t.location.description, t.location.address].filter(Boolean).join(', ');
    return {
      title: `${t.order}. Bódorgó – ${t.title}`,
      start: new Date(t.startDate),
      days: t.duration,
      description: [
        `Kezdés: ${start}`,
        `${t.duration} nap / ${t.duration - 1} éjszaka`,
        ...(place ? [`Helyszín: ${place}`] : []),
      ].join('\n'),
      location: place || undefined,
      url: `${window.location.origin}/taborok/${t.slug || t._id}`,
    };
  }

  googleCalendarLink(t: Tour): string {
    return googleCalendarUrl(this.calendarEvent(t));
  }

  saveIcs(t: Tour) {
    downloadIcs(this.calendarEvent(t), `bodorgo-${t.order}.ics`);
    this.showCalendarMenu.set(false);
  }

  wazeUrl(t: Tour): string {
    const [lng, lat] = t.location.coordinates;
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }

  googleMapsUrl(t: Tour): string {
    const [lng, lat] = t.location.coordinates;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }

  // The login-only cover image URL ('' for a tour with no cover yet).
  coverUrl(t: Tour): string {
    return this.tourService.coverUrl(t) ?? '';
  }

  tourVideoUrl(t: Tour, v: TourVideo): string {
    return this.tourService.videoUrl(t._id, v.id);
  }

  tourVideoCoverUrl(t: Tour, v: TourVideo): string {
    return this.tourService.videoCoverUrl(t._id, v.id);
  }

  tourVideoSubtitlesUrl(t: Tour, v: TourVideo): string {
    return this.tourService.subtitlesUrl(t._id, v.id);
  }

  // Extrák (tour-extras) uploaded or deleted a document.
  onDocumentsChanged(extraDocuments: ExtraDocument[]) {
    this.tour.update((t) => (t ? { ...t, extraDocuments } : t));
  }

  // Clicking the cover image opens the gallery at its first photo, rather
  // than the old separate single-image popup - the cover is just the
  // tours-list thumbnail, the gallery is the actual photo collection now
  // that one exists. A no-op if the gallery hasn't loaded (or doesn't
  // exist) yet for this tour, rather than erroring.
  openCoverGallery() {
    const t = this.tour();
    const images = this.tourImages();
    if (!t || images.length === 0) return;
    const photos: GalleryPhoto[] = images.map((img) => ({
      name: img.filename,
      width: img.width,
      height: img.height,
      thumbUrl: this.tourService.tourImageThumbUrl(t._id, img.filename),
      fullUrl: this.tourService.tourImageFullUrl(t._id, img.filename),
      downloadUrl: this.tourService.tourImageDownloadUrl(t._id, img.filename),
      mobile: img.source === 'mobile',
      restricted: img.restricted,
    }));
    void this.gallery.open(photos, 0, {
      zipUrl: this.tourService.tourImagesZipUrl(t._id),
      zipBytes: images.reduce((sum, img) => sum + img.size, 0),
      onRestrict: this.canEdit()
        ? (photo, restricted) => this.setImageRestricted(photo.name, restricted)
        : undefined,
    });
  }

  // Admins, from the viewer's lock: a photo only for the tour's attendees
  // (or for everyone again). True once saved.
  private setImageRestricted(filename: string, restricted: boolean): Promise<boolean> {
    const t = this.tour();
    if (!t) return Promise.resolve(false);
    return new Promise((resolve) =>
      this.tourService.setImageRestricted(t._id, filename, restricted).subscribe({
        next: () => {
          this.tourImages.update((imgs) =>
            imgs.map((img) => (img.filename === filename ? { ...img, restricted } : img)),
          );
          this.notifications.addSuccess(
            restricted
              ? 'Fénykép korlátozva a résztvevőkre'
              : 'Fénykép újra mindenki számára látható',
          );
          resolve(true);
        },
        error: (err) => {
          this.notifications.addError(
            err?.error?.message ?? 'Hiba történt a korlátozás módosítása közben.',
          );
          resolve(false);
        },
      }),
    );
  }

  // After a sign-up (tour-signup): a full reload rather than patching
  // tour.reservations/participantCount locally - same "just refetch
  // everything" reasoning as onAttendeeNightsUpdated above, the simplest
  // way to keep every derived total (participantCount, attendeePayments,
  // paymentTotals) genuinely in sync with the server.
  onSignedUp() {
    this.loadTour(this.tourId);
    // loadTour's own tour reload doesn't cover this - see reviewStars's
    // own comment on why signing up needs its own explicit nudge.
    this.reviewStars?.refresh();
  }

  openMap() {
    this.showMap.set(true);
  }

  closeMap() {
    this.showMap.set(false);
  }

  // Called when <app-tour-schedule> hands back a fresh event after an opt-in
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

  // The admin added an event in <app-tour-schedule>.
  onEventAdded(added: ScheduleEntry) {
    this.tour.update((cur) => (cur ? { ...cur, schedule: [...(cur.schedule ?? []), added] } : cur));
  }
}
