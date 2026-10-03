import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { API } from '../../../testing/http';
import { fail, logIn, pageTesting, respond } from '../../../testing/component';
import { makePayment, makeTour, tourResponse } from '../../../testing/fixtures';
import { NotificationsService } from '../../notifications/notifications.service';
import { PhotoGalleryService } from '../../shared/photo-gallery';
import { Tour, TourService } from '../../services/tour';
import { TourDetails } from './tour-details';

const IMAGES = [
  { filename: 'a.jpg', width: 1000, height: 750, size: 300, restricted: false },
  { filename: 'b.jpg', width: 800, height: 600, size: 200, restricted: true, source: 'mobile' },
];

describe('TourDetails', () => {
  let fixture: ComponentFixture<TourDetails>;
  let page: TourDetails;

  /** Everything the page and its parts ask for when it opens. */
  const routes = (tour: Tour, over = {}): Record<string, object> => ({
    'GET /tours/t1': tourResponse(tour, over),
    'GET /tours/t1/images': { data: { images: IMAGES } },
    'GET /tours/t1/reviews/me': { data: { isAttendee: true, hasEnded: false, rating: null } },
    'GET /tours/t1/report': { data: { canDownload: false, publishedAt: null } },
    'GET /tours/t1/cancellations': { data: { cancellations: [] } },
    'GET /users': {
      data: {
        users: [
          { _id: 'me', name: 'Teszt Elek', role: 'admin', createdAt: '' },
          { _id: 'new', name: 'Új Ember', role: 'guest', createdAt: '' },
          { _id: 'old', name: 'Régi Tag', role: 'member', createdAt: '', retired: true },
        ],
      },
    },
    'GET /users/me/family': {
      data: {
        members: [
          { _id: 'kid', name: 'Teszt Kata', role: 'member' },
          { _id: 'wife', name: 'Teszt Éva', role: 'member' },
        ],
      },
    },
  });

  function open(role: string | null, tour = makeTour(), over = {}, id: string | null = 't1') {
    TestBed.configureTestingModule({
      imports: [TourDetails],
      providers: [
        pageTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(id ? { id } : {}) } },
        },
      ],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    if (role) logIn({ id: 'me', role, familyId: 'f1' });
    fixture = TestBed.createComponent(TourDetails);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond(routes(tour, over));
    fixture.detectChanges();
    respond(routes(tour, over)); // what the freshly rendered parts ask for
    fixture.detectChanges();
  }

  afterEach(() => vi.restoreAllMocks());

  it('needs a tour id', () => {
    open(null, makeTour(), {}, null);
    expect(page.loadError()).toBe('Hiányzó tábor azonosító.');
  });

  it('says so when the tour cannot be loaded', () => {
    TestBed.configureTestingModule({
      imports: [TourDetails],
      providers: [
        pageTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 't1' }) } },
        },
      ],
    });
    fixture = TestBed.createComponent(TourDetails);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ 'GET /tours/t1': fail(404) });
    fixture.detectChanges();
    expect(page.loadError()).toContain('nem található');
    expect(page.isFull()).toBe(false);
    expect(page.signUpOpen()).toBe(false);
    expect(page.mapEmbedUrl()).toBeNull();
    expect(page.formattedStartDate()).toBe('');
    expect(page.allAttendees()).toEqual([]);
  });

  it('shows a visitor the tour without the members-only parts', () => {
    open(null);
    expect(page.tour()?.title).toBe('Mátra');
    expect(page.participantCount()).toBe(2);
    expect(page.pickerOptions()).toEqual([]);
    expect(page.myScheduleEventCandidates()).toEqual([]);
    expect(page.alreadySignedUp()).toBe(false);
    expect(page.canEdit()).toBe(false);
    expect(page.signUpOpen()).toBe(true); // it starts next year
    expect(page.tourImages()).toEqual([]); // photos are for logged-in people
    expect(fixture.nativeElement.textContent).toContain('Mátra');
  });

  it('lists the attendees by name with what their optional programmes cost', () => {
    open('member');
    expect(page.allAttendees().map((a) => [a.name, a.optionalProgramsCost])).toEqual([
      ['Teszt Elek', 4000],
      ['Teszt Kata', 0],
    ]);
    expect([...page.attendeeUserIds()]).toEqual(['me', 'kid']);
    expect(page.alreadySignedUp()).toBe(true);
    expect(page.hasUnpaidAdvanceInMyGroup()).toBe(true);
  });

  it('shows the programme cost in euros for a euro tour', () => {
    open('member', makeTour({ accommodationCurrency: 'EUR', eurHufExchangeRate: 390 }));
    expect(page.allAttendees()[0].optionalProgramsCost).toBe(11); // 4000 Ft, rounded up
  });

  it('offers a member the family members who are not signed up yet', () => {
    open('member');
    expect(page.pickerOptions()).toEqual([{ _id: 'wife', name: 'Teszt Éva' }]);
    expect(page.myScheduleEventCandidates().map((c) => c._id)).toEqual(['me', 'kid']);
  });

  it('offers a guest only themselves', () => {
    open('guest', makeTour({ reservations: [] }));
    expect(page.pickerOptions()).toEqual([{ _id: 'me', name: 'Teszt Elek' }]);
  });

  it('offers an admin everyone who is not signed up and not suspended', () => {
    open('admin');
    expect(page.pickerOptions()).toEqual([{ _id: 'new', name: 'Új Ember' }]);
    expect([...page.retiredUserIds()]).toEqual(['old']);
    expect(page.canEdit()).toBe(true);
    expect(page.myScheduleEventCandidates()).toHaveLength(2);
  });

  it('is full at the capacity', () => {
    open('member', makeTour({ maxCapacity: 2 }));
    expect(page.isFull()).toBe(true);
  });

  it('closes the sign-up once the tour has started, except for an admin', () => {
    const past = makeTour({ startDate: '2020-07-10T08:00:00.000Z' });
    open('member', past);
    expect(page.signUpOpen()).toBe(false);
    TestBed.resetTestingModule();
    open('admin', past);
    expect(page.signUpOpen()).toBe(true);
  });

  it('locks a closed tour, for admins too', () => {
    open('admin', makeTour({ closed: true, closedAt: '2026-03-05T10:00:00Z' }));
    expect(page.canEdit()).toBe(false);
    expect(page.closedLabel()).toBe('Lezárt tábor (2026. márc. 5.) – már nem módosítható');
    expect(page.myScheduleEventCandidates()).toEqual([]);
  });

  it('becomes closed when the tour is closed on the page', () => {
    open('admin');
    expect(page.closedLabel()).toBe('Lezárt tábor – már nem módosítható');
    page.onTourClosed('2026-03-05T10:00:00Z');
    expect(page.tour()?.closed).toBe(true);
    expect(page.canEdit()).toBe(false);
  });

  it('shows the 360° panorama only for a real web address', () => {
    open(null, makeTour({ panoramaUrl: 'https://padlasfoto.hu/x', panoramaTitle: ' Kilátó ' }));
    expect(page.panoramaEmbedUrl()).not.toBeNull();
    expect(page.panoramaLabel()).toBe('360°-os panoráma: Kilátó');

    TestBed.resetTestingModule();
    open(null, makeTour({ panoramaUrl: 'javascript:alert(1)' }));
    expect(page.panoramaEmbedUrl()).toBeNull();
    expect(page.panoramaLabel()).toBe('360°-os panoráma');
  });

  it('builds the map and navigation links from the coordinates', () => {
    open(null);
    const t = page.tour()!;
    expect(page.wazeUrl(t)).toBe('https://waze.com/ul?ll=47.87,19.97&navigate=yes');
    expect(page.googleMapsUrl(t)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=47.87,19.97',
    );
    expect(page.mapEmbedUrl()).not.toBeNull();
    page.openMap();
    expect(page.showMap()).toBe(true);
    page.closeMap();
    expect(page.showMap()).toBe(false);
  });

  it('builds the file links of the tour', () => {
    open(null, makeTour({ coverUpdatedAt: 'v1' }));
    const t = page.tour()!;
    const video = { id: 'v1', label: 'Film', hasCover: true, hasSubtitles: true };
    expect(page.coverUrl(t)).toBe(`${API}/tours/t1/cover?v=v1`);
    expect(page.coverUrl(makeTour())).toBe('');
    expect(page.tourVideoUrl(t, video)).toBe(`${API}/tours/t1/videos/v1/video`);
    expect(page.tourVideoCoverUrl(t, video)).toBe(`${API}/tours/t1/videos/v1/cover`);
    expect(page.tourVideoSubtitlesUrl(t, video)).toBe(`${API}/tours/t1/videos/v1/subtitles.vtt`);
    expect(page.attendeesExcelUrl('t1')).toBe(`${API}/tours/t1/attendees/export.xlsx`);
  });

  it('makes the phone numbers in the contact line callable', () => {
    open(null);
    expect(page.contactParts('Gazda: +36 30 123 4567 (este)')).toEqual([
      { text: 'Gazda: ' },
      { text: '+36 30 123 4567', tel: '+36301234567' },
      { text: ' (este)' },
    ]);
    expect(page.contactParts('Csak e-mailben')).toEqual([{ text: 'Csak e-mailben' }]);
  });

  it('offers the tour for the calendar', () => {
    open(null);
    const t = page.tour()!;
    const url = new URL(page.googleCalendarLink(t));
    expect(url.searchParams.get('text')).toBe('12. Bódorgó – Mátra');
    expect(url.searchParams.get('location')).toBe('Mátraháza, Mátraháza, Fő út 1.');
    expect(url.searchParams.get('details')).toContain('3 nap / 2 éjszaka');
    expect(url.searchParams.get('details')).toContain('/taborok/matra');

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL ??= () => 'blob:x';
    URL.revokeObjectURL ??= () => {};
    page.toggleCalendarMenu(new Event('click'));
    expect(page.showCalendarMenu()).toBe(true);
    page.saveIcs(t);
    expect(click).toHaveBeenCalled();
    expect(page.showCalendarMenu()).toBe(false);
    page.toggleCalendarMenu(new Event('click'));
    page.closeCalendarMenu();
    expect(page.showCalendarMenu()).toBe(false);
  });

  it('remembers whether the participant list was open', () => {
    open('member');
    page.toggleParticipants();
    fixture.detectChanges();
    expect(page.showParticipants()).toBe(true);
    expect(TestBed.inject(TourService).showParticipantsPreference).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Teszt Kata');
    page.toggleParticipants();
    expect(TestBed.inject(TourService).showParticipantsPreference).toBe(false);
  });

  it('reloads the tour after a sign-up or a changed attendee', () => {
    open('member');
    page.onSignedUp();
    respond({
      'GET /tours/t1': tourResponse(makeTour(), {
        participantCount: 3,
        attendeePayments: [makePayment({ paid: true })],
      }),
    });
    expect(page.participantCount()).toBe(3);
    expect(page.hasUnpaidAdvanceInMyGroup()).toBe(false);

    page.onAttendeeNightsUpdated();
    respond({ 'GET /tours/t1': tourResponse(makeTour(), { participantCount: 4 }) });
    expect(page.participantCount()).toBe(4);
  });

  it('takes over changes made in its parts', () => {
    open('admin');
    page.onEventUpdated({ _id: 'e1', day: 1, time: '11:00', description: 'Érkezés' });
    expect(page.tour()?.schedule?.[0].time).toBe('11:00');
    page.onEventAdded({ _id: 'e3', day: 3, time: '10:00', description: 'Búcsú' });
    expect(page.tour()?.schedule).toHaveLength(3);
    page.onReviewSubmitted({ average: 9, quantity: 5 });
    expect(page.tour()).toMatchObject({ ratingsAverage: 9, ratingsQuantity: 5 });
    page.onDocumentsChanged([
      { _id: 'd1', title: 'Térkép', filename: 't.pdf', mimeType: 'application/pdf' },
    ]);
    expect(page.tour()?.extraDocuments).toHaveLength(1);
  });

  describe('photo gallery', () => {
    let openGallery: ReturnType<typeof vi.spyOn>;

    function openWith(role: string) {
      open(role);
      openGallery = vi
        .spyOn(TestBed.inject(PhotoGalleryService), 'open')
        .mockResolvedValue(undefined as never);
    }

    it('opens the photos of the tour with the zip download', () => {
      openWith('member');
      expect(page.tourImages()).toHaveLength(2);
      page.openCoverGallery();
      const [photos, index, options] = openGallery.mock.calls[0] as [
        { name: string; mobile: boolean; fullUrl: string }[],
        number,
        { zipUrl: string; zipBytes: number; onRestrict?: unknown },
      ];
      expect(photos.map((p) => [p.name, p.mobile])).toEqual([
        ['a.jpg', false],
        ['b.jpg', true],
      ]);
      expect(photos[0].fullUrl).toBe(`${API}/tours/t1/images/a.jpg`);
      expect(index).toBe(0);
      expect(options.zipUrl).toBe(`${API}/tours/t1/images/download-zip`);
      expect(options.zipBytes).toBe(500);
      expect(options.onRestrict).toBeUndefined(); // only an admin can restrict
    });

    it('has nothing to open without photos', () => {
      openWith('member');
      page.tourImages.set([]);
      page.openCoverGallery();
      expect(openGallery).not.toHaveBeenCalled();
    });

    it('lets an admin restrict a photo to the attendees', async () => {
      openWith('admin');
      const notifications = TestBed.inject(NotificationsService);
      const success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
      const error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
      page.openCoverGallery();
      const { onRestrict } = openGallery.mock.calls[0][2] as {
        onRestrict: (photo: { name: string }, restricted: boolean) => Promise<boolean>;
      };

      const done = onRestrict({ name: 'a.jpg' }, true);
      respond({ 'PATCH /tours/t1/images/a.jpg': { data: {} } });
      expect(await done).toBe(true);
      expect(page.tourImages()[0].restricted).toBe(true);
      expect(success).toHaveBeenCalledWith('Fénykép korlátozva a résztvevőkre');

      const undone = onRestrict({ name: 'a.jpg' }, false);
      respond({ 'PATCH /tours/t1/images/a.jpg': { data: {} } });
      await undone;
      expect(success).toHaveBeenCalledWith('Fénykép újra mindenki számára látható');

      const failed = onRestrict({ name: 'a.jpg' }, true);
      respond({ 'PATCH /tours/t1/images/a.jpg': fail() });
      expect(await failed).toBe(false);
      expect(error).toHaveBeenCalledWith('Hiba történt a korlátozás módosítása közben.');
    });
  });
});
