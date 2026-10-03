import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, formEntries, httpTesting, itSendsRequests } from '../../testing/http';
import { AttendeePayment, TourService, attendeeUserId, isInMyPaymentGroup } from './tour';

describe('TourService', () => {
  let service: TourService;
  let http: HttpTestingController;
  const tours = `${API}/tours`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(TourService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('requests', () => {
    itSendsRequests([
      ['deleteDocument', () => service.deleteDocument('d1'), 'DELETE', `${API}/documents/d1`],
      ['emailPdf', () => service.emailPdf('t1'), 'POST', `${tours}/t1/pdf/email`, {}],
      ['getMailings', () => service.getMailings('t1'), 'GET', `${tours}/t1/mailings`],
      [
        'saveMailDraft',
        () => service.saveMailDraft('t1', { subject: 's', html: '<p>h</p>', delta: {} }),
        'PUT',
        `${tours}/t1/mailings/draft`,
        { subject: 's', html: '<p>h</p>', delta: {} },
      ],
      ['getReport', () => service.getReport('t1'), 'GET', `${tours}/t1/report`],
      [
        'saveReport',
        () =>
          service.saveReport('t1', {
            days: [],
            facts: { place: 'p', dates: 'd', headcount: 'h' },
            photo: null,
          }),
        'PUT',
        `${tours}/t1/report`,
        { days: [], facts: { place: 'p', dates: 'd', headcount: 'h' }, photo: null },
      ],
      ['finishReport', () => service.finishReport('t1'), 'POST', `${tours}/t1/report/finish`],
      ['reopenReport', () => service.reopenReport('t1'), 'POST', `${tours}/t1/report/reopen`],
      [
        'sendMailTest',
        () => service.sendMailTest('t1', true),
        'POST',
        `${tours}/t1/mailings/test`,
        { withPdf: true },
      ],
      [
        'sendMailing',
        () => service.sendMailing('t1', false),
        'POST',
        `${tours}/t1/mailings/send`,
        { withPdf: false },
      ],
      ['getTours', () => service.getTours(), 'GET', tours],
      ['getTourYears', () => service.getTourYears(), 'GET', `${tours}/years`],
      [
        'getToursOfYear asks for that calendar year only',
        () => service.getToursOfYear(2025),
        'GET',
        `${tours}?startDate.gte=2025-01-01T00:00:00&startDate.lt=2026-01-01T00:00:00`,
      ],
      ['getLast3Tours', () => service.getLast3Tours(), 'GET', `${tours}/last-3`],
      [
        'getToursWithParams',
        () => service.getToursWithParams({ sort: 'order', limit: 3 }),
        'GET',
        `${tours}?sort=order&limit=3`,
      ],
      ['getTour', () => service.getTour('t1'), 'GET', `${tours}/t1`],
      ['closeTour', () => service.closeTour('t1'), 'POST', `${tours}/t1/close`, {}],
      ['createTour', () => service.createTour({ title: 'Új' }), 'POST', tours, { title: 'Új' }],
      [
        'updateTour',
        () => service.updateTour('t1', { title: 'Más' }),
        'PATCH',
        `${tours}/t1`,
        { title: 'Más' },
      ],
      [
        'updateAccommodation',
        () => service.updateAccommodation('t1', []),
        'PUT',
        `${tours}/t1/accommodation`,
        { houses: [] },
      ],
      ['getRoomBoard', () => service.getRoomBoard('t1'), 'GET', `${tours}/t1/rooms`],
      [
        'assignRoom',
        () => service.assignRoom('t1', 'a1', null),
        'PUT',
        `${tours}/t1/rooms/assignment`,
        { attendeeId: 'a1', roomId: null },
      ],
      [
        'setRoomsFinalized',
        () => service.setRoomsFinalized('t1', true),
        'PUT',
        `${tours}/t1/rooms/finalized`,
        { finalized: true },
      ],
      ['getTicker', () => service.getTicker(), 'GET', `${tours}/ticker`],
      [
        'signUp',
        () => service.signUp('t1', ['u1', 'u2']),
        'POST',
        `${tours}/t1/signup`,
        { attendeeIds: ['u1', 'u2'] },
      ],
      [
        'updateAttendeeNights',
        () => service.updateAttendeeNights('t1', 'r1', 'a1', 2),
        'PATCH',
        `${tours}/t1/reservations/r1/attendees/a1/nights`,
        { nights: 2 },
      ],
      [
        'updateAttendeeFeeExempt',
        () => service.updateAttendeeFeeExempt('t1', 'r1', 'a1', true),
        'PATCH',
        `${tours}/t1/reservations/r1/attendees/a1/fee-exempt`,
        { feeExempt: true },
      ],
      [
        'withdrawAttendee sends the reason in a DELETE body',
        () => service.withdrawAttendee('t1', 'r1', 'a1', 'beteg'),
        'DELETE',
        `${tours}/t1/reservations/r1/attendees/a1`,
        { reason: 'beteg' },
      ],
      [
        'getCancellations',
        () => service.getCancellations('t1'),
        'GET',
        `${tours}/t1/cancellations`,
      ],
      ['getTourStats', () => service.getTourStats(), 'GET', `${tours}/tour-stats`],
      [
        'updateScheduleEventParticipants',
        () => service.updateScheduleEventParticipants('t1', 'e1', ['u1']),
        'PATCH',
        `${tours}/t1/schedule/e1/participants`,
        { userIds: ['u1'] },
      ],
      [
        'updateScheduleEvent',
        () => service.updateScheduleEvent('t1', 'e1', { title: 'Túra' } as never),
        'PATCH',
        `${tours}/t1/schedule/e1`,
        { title: 'Túra' },
      ],
      [
        'createScheduleEvent',
        () => service.createScheduleEvent('t1', { title: 'Túra' } as never),
        'POST',
        `${tours}/t1/schedule`,
        { title: 'Túra' },
      ],
      ['getTourImages', () => service.getTourImages('t1'), 'GET', `${tours}/t1/images`],
      [
        'getChatBackground',
        () => service.getChatBackground('t1'),
        'GET',
        `${tours}/t1/chat/background`,
      ],
      [
        'nextChatBackground',
        () => service.nextChatBackground('t1'),
        'POST',
        `${tours}/t1/chat/background/next`,
      ],
      [
        'setImageRestricted escapes the file name',
        () => service.setImageRestricted('t1', 'a b.jpg', true),
        'PATCH',
        `${tours}/t1/images/a%20b.jpg`,
        { restricted: true },
      ],
      ['getMyReview', () => service.getMyReview('t1'), 'GET', `${tours}/t1/reviews/me`],
      [
        'submitReview',
        () => service.submitReview('t1', 4),
        'PUT',
        `${tours}/t1/reviews`,
        { rating: 4 },
      ],
    ]);
  });

  it('uploads a document as a form with its title and tour', () => {
    const file = new File(['x'], 'terkep.pdf', { type: 'application/pdf' });
    service.uploadDocument('t1', 'Térkép', file).subscribe();
    const req = http.expectOne(`${API}/documents`);
    expect(req.request.method).toBe('POST');
    expect(formEntries(req.request.body)).toEqual({
      name: 'Térkép',
      tour: 't1',
      file: 'terkep.pdf',
    });
    req.flush({});
  });

  it('uploads a cover image as cover.jpg', () => {
    service.uploadCoverImage('t1', new Blob(['x'])).subscribe();
    const req = http.expectOne(`${tours}/t1/cover`);
    expect(req.request.method).toBe('POST');
    expect(formEntries(req.request.body)).toEqual({ file: 'cover.jpg' });
    req.flush({});
  });

  it('builds the tour file URLs', () => {
    expect(service.pdfUrl('t1')).toBe(`${tours}/t1/pdf`);
    expect(service.attendeesExcelUrl('t1')).toBe(`${tours}/t1/attendees/export.xlsx`);
    expect(service.documentUrl('d1')).toBe(`${API}/documents/d1/file`);
    expect(service.reportPdfUrl('t1')).toBe(`${tours}/t1/report/pdf`);
    expect(service.reportPdfUrl('t1', true)).toBe(`${tours}/t1/report/pdf?draft=1`);
    expect(service.tourImagesZipUrl('t1')).toBe(`${tours}/t1/images/download-zip`);
    expect(service.videoUrl('t1', 'v1')).toBe(`${tours}/t1/videos/v1/video`);
    expect(service.videoCoverUrl('t1', 'v1')).toBe(`${tours}/t1/videos/v1/cover`);
    expect(service.subtitlesUrl('t1', 'v1')).toBe(`${tours}/t1/videos/v1/subtitles.vtt`);
  });

  it('escapes file names and versions in image URLs', () => {
    expect(service.tourImageThumbUrl('t1', 'a b.jpg')).toBe(`${tours}/t1/images/a%20b.jpg/thumb`);
    expect(service.tourImageFullUrl('t1', 'a b.jpg')).toBe(`${tours}/t1/images/a%20b.jpg`);
    expect(service.tourImageDownloadUrl('t1', 'a b.jpg')).toBe(
      `${tours}/t1/images/a%20b.jpg/download`,
    );
    expect(service.chatBackgroundUrl('t1', { version: 'a b' })).toBe(
      `${tours}/t1/chat/background/image?v=a%20b`,
    );
  });

  it('gives a cover URL only for a tour that has a cover', () => {
    expect(service.coverUrl({ _id: 't1' })).toBeNull();
    expect(service.coverUrl({ _id: 't1', coverUpdatedAt: '2026-01-01T10:00:00Z' })).toBe(
      `${tours}/t1/cover?v=2026-01-01T10%3A00%3A00Z`,
    );
  });
});

describe('attendeeUserId', () => {
  it('reads the id whether the user is populated or not', () => {
    expect(attendeeUserId({ user: 'u1', name: 'A' })).toBe('u1');
    expect(attendeeUserId({ user: { _id: 'u2' }, name: 'B' })).toBe('u2');
  });
});

describe('isInMyPaymentGroup', () => {
  const payment = { userId: 'u1', familyId: 'f1' } as AttendeePayment;

  it('is false when nobody is logged in', () => {
    expect(isInMyPaymentGroup(payment, null)).toBe(false);
  });

  it('is true for my own payment', () => {
    expect(isInMyPaymentGroup(payment, { id: 'u1', role: 'member' })).toBe(true);
  });

  it('is true for a family member', () => {
    expect(isInMyPaymentGroup(payment, { id: 'u9', role: 'member', familyId: 'f1' })).toBe(true);
  });

  it('is false for someone else, also when neither has a family', () => {
    expect(isInMyPaymentGroup(payment, { id: 'u9', role: 'member', familyId: 'f2' })).toBe(false);
    expect(
      isInMyPaymentGroup({ userId: 'u1', familyId: null } as AttendeePayment, {
        id: 'u9',
        role: 'member',
      }),
    ).toBe(false);
  });
});
