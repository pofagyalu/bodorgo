import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import type Quill from 'quill';

import { API, formEntries } from '../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../testing/component';
import { makePayment, makeTour } from '../../../testing/fixtures';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { ScheduleEntry, Tour } from '../../services/tour';
import { AttendeeList, AttendeeListRow } from './attendee-list/attendee-list';
import { PayMethods } from './attendee-list/pay-methods/pay-methods';
import { EVENT_FORM_TIME_OPTIONS } from './event-form/event-form';
import { ReviewStars } from './review-stars/review-stars';
import { TourEvent } from './tour-event/tour-event';
import { TourExtras } from './tour-extras/tour-extras';
import { TourMailPanel } from './tour-mail-panel/tour-mail-panel';
import { TourReportPanel } from './tour-report-panel/tour-report-panel';
import { TourSchedule } from './tour-schedule/tour-schedule';
import { TourSignup } from './tour-signup/tour-signup';

let http: HttpTestingController;
let success: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [pageTesting()] });
  http = TestBed.inject(HttpTestingController);
  const notifications = TestBed.inject(NotificationsService);
  success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
  error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const row = (over: Partial<AttendeeListRow> = {}): AttendeeListRow => ({
  ...makePayment(),
  optionalProgramsCost: 0,
  ...over,
});

describe('AttendeeList', () => {
  let fixture: ComponentFixture<AttendeeList>;
  let list: AttendeeList;
  let updated: number;

  const ROWS = [
    row({ attendeeId: 'a1', name: 'Teszt Elek', userId: 'me', optionalProgramsCost: 4000 }),
    row({ attendeeId: 'a2', name: 'Teszt Kata', userId: 'kid', paid: true }),
    row({ attendeeId: 'a3', name: 'Kovács Béla', userId: 'b', familyId: null }),
    row({ attendeeId: 'a4', name: 'Nagy Anna', userId: 'n1', familyId: 'f2' }),
    row({ attendeeId: 'a5', name: 'Kis Pál', userId: 'n2', familyId: 'f2' }),
  ];

  function open(role: string, inputs: Record<string, unknown> = {}) {
    logIn({ id: 'me', role, familyId: 'f1' });
    fixture = TestBed.createComponent(AttendeeList);
    list = fixture.componentInstance;
    const all = {
      tourId: 't1',
      attendees: ROWS,
      totals: { totalPrice: 100000, advance: 30000, advanceInCurrency: 30000, rest: 70000 },
      ...inputs,
    };
    for (const [key, value] of Object.entries(all)) fixture.componentRef.setInput(key, value);
    updated = 0;
    list.nightsUpdated.subscribe(() => updated++);
    fixture.detectChanges();
    respond({ 'GET /tours/t1/cancellations': { data: { cancellations: [{ _id: 'c1' }] } } });
    fixture.detectChanges();
  }

  it('groups families together, ordered by the first name in each', () => {
    open('member');
    expect(list.groupedFamilies.map((g) => g.members.map((m) => m.name))).toEqual([
      ['Kis Pál', 'Nagy Anna'],
      ['Kovács Béla'],
      ['Teszt Elek', 'Teszt Kata'],
    ]);
    expect(list.groupedFamilies.map((g) => g.familyStripe)).toEqual([0, 1, 0]);
  });

  it('sums a family, and names it when everyone shares a surname', () => {
    open('member');
    const [mixed, , teszt] = list.groupedFamilies;
    expect(list.familyLabel(teszt)).toBe('Teszt család összesen');
    expect(list.familyLabel(mixed)).toBe('Család összesen');
    expect(list.familySubtotal(teszt)).toEqual({
      totalPrice: 40000,
      advance: 12000,
      advanceInCurrency: 12000,
      rest: 28000,
      paidCount: 1,
      memberCount: 2,
      optionalProgramsCost: 4000,
    });
  });

  it("shows a member only their own family's subtotal", () => {
    open('member');
    const [other, solo, mine] = list.groupedFamilies;
    expect(list.canSeeFamilySubtotal(mine)).toBe(true);
    expect(list.canSeeFamilySubtotal(other)).toBe(false);
    expect(list.canSeeFamilySubtotal(solo)).toBe(false);

    list.toggleFamilySubtotal(mine.key);
    expect(list.isFamilySubtotalExpanded(mine.key)).toBe(true);
    list.toggleFamilySubtotal(mine.key);
    expect(list.isFamilySubtotalExpanded(mine.key)).toBe(false);
  });

  it('shows an admin every subtotal and the cancellations', () => {
    open('admin');
    expect(list.canSeeFamilySubtotal(list.groupedFamilies[0])).toBe(true);
    expect(list.cancellations()).toHaveLength(1);
    expect(list.showActions).toBe(true);
  });

  it('knows about the optional programmes and the prices', () => {
    open('member');
    expect(list.hasOptionalPrograms).toBe(true);
    expect(list.totalOptionalProgramsCost).toBe(4000);
    expect(list.hasPricing()).toBe(true);
    expect(list.money(12000)).toBe('12 000 Ft');
    expect(list.money(null)).toBe('0 Ft');
    expect(list.advanceTitle(30)).toBeNull();

    fixture.componentRef.setInput('currency', 'EUR');
    expect(list.money(30)).toBe('30 €');
    expect(list.advanceTitle(30)).toBe('30 € előleg, forintban fizetve');
    expect(list.advanceTitle(null)).toBeNull();
  });

  it('lets people cancel for themselves and their family, an admin for anyone', () => {
    open('member');
    expect(ROWS.map((r) => list.canWithdraw(r))).toEqual([true, true, false, false, false]);
    expect(list.showActions).toBe(true);

    fixture.componentRef.setInput('locked', true);
    expect(list.canWithdraw(ROWS[0])).toBe(false);
    expect(list.showActions).toBe(false);
  });

  it('edits the number of nights', () => {
    open('admin');
    list.startEditNights(ROWS[0]);
    expect(list.editingAttendeeId()).toBe('a1');
    expect(list.editNights).toBe(2);
    list.cancelEditNights();
    expect(list.editingAttendeeId()).toBeNull();

    list.startEditNights(ROWS[0]);
    list.editNights = -1;
    list.saveNights(ROWS[0]);
    expect(error).toHaveBeenCalledWith('Az éjszakák száma nem lehet negatív egész szám.');

    list.editNights = 1;
    list.saveNights(ROWS[0]);
    const req = http.expectOne(`${API}/tours/t1/reservations/r1/attendees/a1/nights`);
    expect(req.request.body).toEqual({ nights: 1 });
    req.flush({ data: {} });
    expect(success).toHaveBeenCalledWith('Éjszakák száma mentve');
    expect(updated).toBe(1);

    list.saveNights(ROWS[0]);
    respond({ 'PATCH /tours/t1/reservations/r1/attendees/a1/nights': fail(400, 'Túl sok.') });
    expect(error).toHaveBeenCalledWith('Túl sok.');
    expect(list.savingNights()).toBe(false);
  });

  it('marks an advance as paid in cash, and takes that back', () => {
    open('admin');
    list.toggleCashPaid(ROWS[0]);
    list.toggleCashPaid(ROWS[1]); // one at a time
    const req = http.expectOne(`${API}/payments/cash`);
    expect(req.request.body).toEqual({ tourId: 't1', attendeeIds: ['a1'] });
    req.flush({ status: 'success' });
    expect(success).toHaveBeenCalledWith('Teszt Elek előlege készpénzesen kifizetettnek jelölve.');

    list.toggleCashPaid(row({ name: 'Teszt Elek', paymentMethod: 'cash', paymentId: 'p1' }));
    respond({ 'DELETE /payments/p1': {} });
    expect(success).toHaveBeenCalledWith('Teszt Elek készpénzes befizetése visszavonva.');
    expect(updated).toBe(2);

    list.toggleCashPaid(ROWS[0]);
    respond({ 'POST /payments/cash': fail() });
    expect(error).toHaveBeenCalledWith('Hiba történt a rögzítés során.');
    list.toggleCashPaid(row({ paymentMethod: 'cash', paymentId: 'p1' }));
    respond({ 'DELETE /payments/p1': fail() });
    expect(error).toHaveBeenCalledWith('Hiba történt a visszavonás során.');
    expect(list.markingCashPaidId()).toBeNull();
  });

  it('marks someone as exempt from paying, and back', () => {
    open('admin');
    const url = 'PATCH /tours/t1/reservations/r1/attendees/a1/fee-exempt';
    list.toggleFeeExempt(ROWS[0]);
    list.toggleFeeExempt(ROWS[1]);
    respond({ [url]: { data: {} } });
    expect(success.mock.calls.at(-1)![0]).toContain('díjmentesnek jelölve');

    list.toggleFeeExempt(row({ attendeeId: 'a1', feeExempt: true }));
    respond({ [url]: { data: {} } });
    expect(success.mock.calls.at(-1)![0]).toContain('díjmentessége visszavonva');

    list.toggleFeeExempt(ROWS[0]);
    respond({ [url]: fail() });
    expect(error).toHaveBeenCalledWith('Hiba történt a rögzítés során.');
    expect(list.togglingFeeExemptId()).toBeNull();
  });

  it('cancels a sign-up with a reason', () => {
    open('admin');
    list.confirmWithdraw(); // nobody chosen
    list.askWithdraw(ROWS[0]);
    fixture.detectChanges();
    list.withdrawReason = 'beteg';
    list.confirmWithdraw();
    list.cancelWithdraw(); // not while it is under way
    expect(list.withdrawing()).not.toBeNull();

    const req = http.expectOne(`${API}/tours/t1/reservations/r1/attendees/a1`);
    expect(req.request.body).toEqual({ reason: 'beteg' });
    req.flush({ data: { wasPaid: false, roomsReopened: true } });
    expect(success).toHaveBeenCalledWith(
      'Teszt Elek jelentkezése lemondva. A szobabeosztás újra szerkeszthető.',
    );
    expect(list.withdrawing()).toBeNull();
    expect(updated).toBe(1);
    respond({ 'GET /tours/t1/cancellations': fail() });
    expect(list.cancellations()).toEqual([]);

    list.askWithdraw(ROWS[1]);
    list.confirmWithdraw();
    respond({ 'DELETE /tours/t1/reservations/r1/attendees/a2': fail(400, 'Már elkezdődött.') });
    expect(error).toHaveBeenCalledWith('Már elkezdődött.');
    list.cancelWithdraw();
    expect(list.withdrawing()).toBeNull();
  });
});

describe('PayMethods', () => {
  let fixture: ComponentFixture<PayMethods>;
  let bubble: PayMethods;
  const mouse = { pointerType: 'mouse' } as PointerEvent;
  const touch = { pointerType: 'touch' } as PointerEvent;

  beforeEach(() => {
    fixture = TestBed.createComponent(PayMethods);
    bubble = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('has nothing to show without payment information', () => {
    expect(bubble.hasInfo()).toBe(false);
    bubble.toggle();
    bubble.onEnter(mouse);
    expect(bubble.open()).toBe(false);
  });

  it('lists the accepted ways of paying on the spot', () => {
    fixture.componentRef.setInput('payment', { cash: true, card: false, szep: true });
    expect(bubble.methods().map((m) => m.label)).toEqual(['Készpénz', 'SZÉP kártya']);
  });

  it('opens on a tap or mouse hover, and closes on a tap outside, scroll or resize', () => {
    vi.useFakeTimers();
    fixture.componentRef.setInput('payment', { cash: true, card: true, szep: false });
    bubble.toggle();
    fixture.detectChanges();
    expect(bubble.open()).toBe(true);
    expect(bubble.pos().below).toBe(true); // near the top of the page: opens downwards
    bubble.toggle();
    expect(bubble.open()).toBe(false);

    bubble.onEnter(touch);
    expect(bubble.open()).toBe(false);
    bubble.onEnter(mouse);
    expect(bubble.open()).toBe(true);
    bubble.onLeave(touch);
    bubble.onLeave(mouse);
    vi.advanceTimersByTime(120);
    expect(bubble.open()).toBe(false);

    bubble.toggle();
    bubble.onDocumentPointer({ target: fixture.nativeElement } as unknown as PointerEvent);
    expect(bubble.open()).toBe(true);
    bubble.onDocumentPointer({ target: document.body } as unknown as PointerEvent);
    expect(bubble.open()).toBe(false);

    bubble.toggle();
    document.dispatchEvent(new Event('scroll'));
    expect(bubble.open()).toBe(false);
    vi.useRealTimers();
  });

  it('opens upwards when there is room above', () => {
    fixture.componentRef.setInput('payment', { cash: true, card: true, szep: false });
    vi.spyOn(fixture.nativeElement, 'getBoundingClientRect').mockReturnValue({
      top: 600,
      bottom: 620,
      left: 100,
      width: 40,
    } as DOMRect);
    bubble.toggle();
    expect(bubble.pos()).toMatchObject({ below: false, top: null });
  });
});

describe('TourSignup', () => {
  let fixture: ComponentFixture<TourSignup>;
  let signup: TourSignup;
  let signedUp: number;

  beforeEach(() => {
    fixture = TestBed.createComponent(TourSignup);
    signup = fixture.componentInstance;
    fixture.componentRef.setInput('tourId', 't1');
    fixture.componentRef.setInput('options', [
      { _id: 'me', name: 'Teszt Elek' },
      { _id: 'kid', name: 'Teszt Kata' },
    ]);
    fixture.componentRef.setInput('signUpOpen', true);
    signedUp = 0;
    signup.signedUp.subscribe(() => signedUp++);
    fixture.detectChanges();
  });

  it('signs up the only option with one click', () => {
    signup.signUpSingle();
    const req = http.expectOne(`${API}/tours/t1/signup`);
    expect(req.request.body).toEqual({ attendeeIds: ['me'] });
    expect(signup.signingUp()).toBe(true);
    req.flush({ data: {} });
    expect(signedUp).toBe(1);
    expect(signup.signingUp()).toBe(false);
  });

  it('signs up the people ticked in the picker', () => {
    logIn({ role: 'member' });
    signup.openAttendeePicker();
    fixture.detectChanges();
    signup.signUpSelected(); // nobody ticked yet
    http.expectNone(`${API}/tours/t1/signup`);

    signup.toggleAttendeeSelected('me');
    signup.toggleAttendeeSelected('kid');
    signup.toggleAttendeeSelected('me');
    expect(signup.isAttendeeSelected('kid')).toBe(true);
    expect(signup.isAttendeeSelected('me')).toBe(false);
    signup.signUpSelected();
    const req = http.expectOne(`${API}/tours/t1/signup`);
    expect(req.request.body).toEqual({ attendeeIds: ['kid'] });
    req.flush({ data: {} });
    expect(signup.showAttendeePicker()).toBe(false);
    expect(signup.selectedAttendeeIds().size).toBe(0);
  });

  it('shows why a sign-up was refused, until the picker is closed', () => {
    signup.openAttendeePicker();
    signup.toggleAttendeeSelected('me');
    signup.signUpSelected();
    respond({ 'POST /tours/t1/signup': fail(400, 'Betelt a tábor.') });
    expect(signup.signUpError()).toBe('Betelt a tábor.');
    expect(signedUp).toBe(0);
    signup.closeAttendeePicker();
    expect(signup.signUpError()).toBeNull();
    expect(signup.selectedAttendeeIds().size).toBe(0);
  });

  it('has nobody to sign up without options', () => {
    fixture.componentRef.setInput('options', []);
    signup.signUpSingle();
    http.expectNone(`${API}/tours/t1/signup`);
  });
});

describe('ReviewStars', () => {
  let fixture: ComponentFixture<ReviewStars>;
  let stars: ReviewStars;

  function open(review: object) {
    fixture = TestBed.createComponent(ReviewStars);
    stars = fixture.componentInstance;
    fixture.componentRef.setInput('tourId', 't1');
    fixture.componentRef.setInput('averageRating', 8.5);
    fixture.componentRef.setInput('reviewCount', 4);
    fixture.detectChanges();
    respond({ 'GET /tours/t1/reviews/me': review });
    fixture.detectChanges();
  }

  it('lets an attendee rate only after the tour has ended', () => {
    open({ data: { isAttendee: true, hasEnded: false, rating: null } });
    expect(stars.loaded()).toBe(true);
    expect(stars.isAttendee()).toBe(true);
    expect(stars.canReview()).toBe(false);

    stars.refresh();
    respond({
      'GET /tours/t1/reviews/me': { data: { isAttendee: true, hasEnded: true, rating: 7 } },
    });
    expect(stars.canReview()).toBe(true);
    expect(stars.displayRating()).toBe(7);
  });

  it('counts as loaded even when the request fails', () => {
    open(fail());
    expect(stars.loaded()).toBe(true);
    expect(stars.canReview()).toBe(false);
  });

  it('previews the hovered star and saves the clicked one', () => {
    open({ data: { isAttendee: true, hasEnded: true, rating: 7 } });
    const emitted: unknown[] = [];
    stars.reviewSubmitted.subscribe((r) => emitted.push(r));
    stars.startEditing(new MouseEvent('click'));
    fixture.detectChanges();
    stars.onHover(9);
    expect(stars.displayRating()).toBe(9);
    stars.onLeave();
    expect(stars.displayRating()).toBe(7);

    stars.onClick(9);
    stars.onClick(3); // ignored while saving
    stars.cancelEditing(); // also ignored while saving
    expect(stars.editing()).toBe(true);
    const req = http.expectOne(`${API}/tours/t1/reviews`);
    expect(req.request.body).toEqual({ rating: 9 });
    req.flush({ data: { rating: 9, ratingsAverage: 8.6, ratingsQuantity: 5 } });
    expect(stars.savedRating()).toBe(9);
    expect(stars.editing()).toBe(false);
    expect(emitted).toEqual([{ average: 8.6, quantity: 5 }]);
    expect(success).toHaveBeenCalledWith('Értékelés mentve');
  });

  it('stops editing on Escape or a click elsewhere, and reports a failed save', () => {
    open({ data: { isAttendee: true, hasEnded: true, rating: null } });
    stars.startEditing(new MouseEvent('click'));
    stars.onDocumentClick({ target: fixture.nativeElement } as unknown as MouseEvent);
    expect(stars.editing()).toBe(true);
    stars.onDocumentClick({ target: document.body } as unknown as MouseEvent);
    expect(stars.editing()).toBe(false);

    stars.onClick(5);
    respond({ 'PUT /tours/t1/reviews': fail(400, 'Még nem ért véget.') });
    expect(error).toHaveBeenCalledWith('Még nem ért véget.');
    expect(stars.submitting()).toBe(false);
  });
});

describe('TourSchedule', () => {
  let fixture: ComponentFixture<TourSchedule>;
  let schedule: TourSchedule;

  function open(tour: Tour, role = 'admin') {
    logIn({ id: 'me', role });
    fixture = TestBed.createComponent(TourSchedule);
    schedule = fixture.componentInstance;
    fixture.componentRef.setInput('tour', tour);
    fixture.componentRef.setInput('candidates', [{ _id: 'me', name: 'Teszt Elek' }]);
    fixture.detectChanges();
  }

  it('lays the programme out by day, in time order, with the weather', () => {
    const tour = makeTour({
      startDate: '2026-07-10T08:00:00',
      schedule: [
        { _id: 'b', day: 1, time: '18:00', description: 'Vacsora' },
        { _id: 'a', day: 1, time: '10:00', description: 'Érkezés' },
        { _id: 'c', day: 3, time: '09:00', description: 'Búcsú' },
      ],
      dailyWeather: [{ day: 2, condition: 'rain' } as never],
    });
    open(tour);
    const days = schedule.dayGroups();
    expect(days.map((d) => d.label)).toEqual([
      '2026. július 10., péntek',
      '2026. július 11., szombat',
      '2026. július 12., vasárnap',
    ]);
    expect(days.map((d) => d.events.map((e) => e._id))).toEqual([['a', 'b'], [], ['c']]);
    expect(days[1].weather).toMatchObject({ condition: 'rain' });
    expect(schedule.weatherIconPath('rain')).toBe('assets/images/weather/rain.svg');
    expect(schedule.weatherConditionLabel('partly-cloudy')).toBe('Változóan felhős');
    expect(fixture.nativeElement.textContent).toContain('Vacsora');
  });

  it('is read-only for members, and for everyone once the tour is closed', () => {
    open(makeTour(), 'member');
    expect(schedule.canEdit()).toBe(false);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    open(makeTour({ closed: true }));
    expect(schedule.canEdit()).toBe(false);
  });

  it('adds a programme item to a day', () => {
    open(makeTour());
    const added: ScheduleEntry[] = [];
    schedule.eventAdded.subscribe((e) => added.push(e));
    schedule.startAddEvent(2);
    fixture.detectChanges();
    expect(schedule.addingEventForDay()).toBe(2);
    Object.assign(schedule.addEventForm, {
      time: '14:00',
      description: 'Fürdő',
      isOptional: true,
      extraCost: 2500,
    });
    schedule.saveNewEvent(2);
    http = TestBed.inject(HttpTestingController);
    const req = http.expectOne(`${API}/tours/t1/schedule`);
    expect(req.request.body).toEqual({
      day: 2,
      time: '14:00',
      description: 'Fürdő',
      isOptional: true,
      extraCost: 2500,
    });
    req.flush({ data: { event: { _id: 'new', ...req.request.body } } });
    expect(added[0]._id).toBe('new');
    expect(schedule.addingEventForDay()).toBe(null);
  });

  it('drops the cost of an item that is not optional, and shows a failed save', () => {
    open(makeTour());
    schedule.startAddEvent(1);
    Object.assign(schedule.addEventForm, { description: 'Túra', extraCost: 999 });
    schedule.saveNewEvent(1);
    http = TestBed.inject(HttpTestingController);
    const req = http.expectOne(`${API}/tours/t1/schedule`);
    expect(req.request.body.extraCost).toBeUndefined();
    req.flush({ message: 'Hiányzó leírás.' }, { status: 400, statusText: 'Bad Request' });
    expect(schedule.addEventError()).toBe('Hiányzó leírás.');
    expect(schedule.addingEvent()).toBe(false);
    schedule.cancelAddEvent();
    expect(schedule.addingEventForDay()).toBeNull();
    expect(schedule.addEventError()).toBeNull();
  });

  // What cdk hands moveEvent: the dragged event, and the day it was let go on.
  const dropOn = (event: ScheduleEntry, day: number) =>
    ({ item: { data: event }, container: { data: day } }) as never;

  it('moves a dragged programme item to the day it is dropped on', () => {
    const event = { _id: 'e1', day: 1, time: '18:00', description: 'Vacsora' };
    open(makeTour({ schedule: [event] }));
    const updates: ScheduleEntry[] = [];
    schedule.eventUpdated.subscribe((e) => updates.push(e));
    expect(fixture.nativeElement.querySelectorAll('.drag-handle')).toHaveLength(1);

    // Back on its own day: nothing.
    schedule.moveEvent(dropOn(event, 1));
    expect(updates).toEqual([]);

    schedule.moveEvent(dropOn(event, 3));
    // Shown moved at once...
    expect(updates).toEqual([{ ...event, day: 3 }]);
    const req = http.expectOne(`${API}/tours/t1/schedule/e1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ day: 3 });
    // ...then as the server saved it.
    req.flush({ data: { event: { ...event, day: 3 } } });
    expect(updates).toHaveLength(2);
    expect(success).toHaveBeenCalledWith('Esemény áthelyezve');
  });

  it('puts a moved item back when the server refuses, and has no grip for a member', () => {
    const event = { _id: 'e1', day: 1, time: '18:00', description: 'Vacsora' };
    open(makeTour({ schedule: [event] }));
    const updates: ScheduleEntry[] = [];
    schedule.eventUpdated.subscribe((e) => updates.push(e));
    schedule.moveEvent(dropOn(event, 2));
    http
      .expectOne(`${API}/tours/t1/schedule/e1`)
      .flush({ message: 'Ez a tábor le van zárva.' }, { status: 403, statusText: 'Forbidden' });
    expect(updates.map((e) => e.day)).toEqual([2, 1]);
    expect(error).toHaveBeenCalledWith('Ez a tábor le van zárva.');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    open(makeTour({ schedule: [event] }), 'member');
    expect(fixture.nativeElement.querySelectorAll('.drag-handle')).toHaveLength(0);
    schedule.moveEvent(dropOn(event, 2));
    expect(TestBed.inject(HttpTestingController).match(() => true)).toEqual([]);
  });

  it('offers half-hour steps for the time', () => {
    expect(EVENT_FORM_TIME_OPTIONS).toHaveLength(48);
    expect(EVENT_FORM_TIME_OPTIONS.slice(0, 3)).toEqual(['00:00', '00:30', '01:00']);
    expect(EVENT_FORM_TIME_OPTIONS.at(-1)).toBe('23:30');
  });
});

describe('TourEvent', () => {
  let fixture: ComponentFixture<TourEvent>;
  let item: TourEvent;
  let updates: ScheduleEntry[];
  const EVENT = makeTour().schedule![1]; // the optional one, "me" has joined

  beforeEach(() => {
    logIn({ id: 'me', role: 'admin' });
    fixture = TestBed.createComponent(TourEvent);
    item = fixture.componentInstance;
    fixture.componentRef.setInput('event', EVENT);
    fixture.componentRef.setInput('tourId', 't1');
    fixture.componentRef.setInput('candidates', [
      { _id: 'me', name: 'Teszt Elek' },
      { _id: 'kid', name: 'Teszt Kata' },
    ]);
    updates = [];
    item.updated.subscribe((e) => updates.push(e));
    fixture.detectChanges();
  });

  it('knows who of mine has joined', () => {
    expect([...item.myJoinedCandidateIds()]).toEqual(['me']);
    expect(item.hasAnyOfMineJoined()).toBe(true);
    item.toggleExpanded();
    fixture.detectChanges();
    expect(item.expanded()).toBe(true);
  });

  it('changes who joins the programme', () => {
    item.openPicker();
    fixture.detectChanges();
    expect(item.isCandidateSelected('me')).toBe(true);
    item.toggleCandidateSelected('kid');
    item.toggleCandidateSelected('me');
    item.savePicker();
    const req = http.expectOne(`${API}/tours/t1/schedule/e2/participants`);
    expect(req.request.body).toEqual({ userIds: ['kid'] });
    req.flush({ data: { participants: [{ user: 'kid', name: 'Teszt Kata' }] } });
    expect(updates[0].participants).toEqual([{ user: 'kid', name: 'Teszt Kata' }]);
    expect(item.pickerOpen()).toBe(false);
  });

  it('shows why the change was refused', () => {
    item.openPicker();
    item.savePicker();
    respond({ 'PATCH /tours/t1/schedule/e2/participants': fail(400, 'Lezárt tábor.') });
    expect(item.saveError()).toBe('Lezárt tábor.');
    item.closePicker();
    expect(item.pickerOpen()).toBe(false);
  });

  it('edits the programme item', () => {
    item.startEdit();
    fixture.detectChanges();
    expect(item.editForm).toEqual({
      time: '09:00',
      description: 'Kalandpark',
      isOptional: true,
      extraCost: 4000,
    });
    item.editForm.isOptional = false;
    item.saveEdit();
    const req = http.expectOne(`${API}/tours/t1/schedule/e2`);
    expect(req.request.body).toEqual({
      time: '09:00',
      description: 'Kalandpark',
      isOptional: false,
      extraCost: undefined,
    });
    req.flush({ data: { event: { ...EVENT, isOptional: false } } });
    expect(updates[0].isOptional).toBe(false);
    expect(item.editing()).toBe(false);

    item.startEdit();
    item.saveEdit();
    respond({ 'PATCH /tours/t1/schedule/e2': fail() });
    expect(item.editError()).toBe('Hiba történt a mentés során.');
    item.cancelEdit();
    expect(item.editing()).toBe(false);
    expect(item.editError()).toBeNull();
  });
});

describe('TourExtras', () => {
  let fixture: ComponentFixture<TourExtras>;
  let extras: TourExtras;
  const DOC = {
    _id: 'd1',
    title: 'Térkép',
    filename: 't.pdf',
    mimeType: 'application/pdf',
  } as const;

  function open(tour: Tour, role = 'admin', report: object = { data: { canDownload: false } }) {
    logIn({ id: 'me', role });
    fixture = TestBed.createComponent(TourExtras);
    extras = fixture.componentInstance;
    fixture.componentRef.setInput('tour', tour);
    fixture.detectChanges();
    respond({ 'GET /tours/t1/report': report });
    fixture.detectChanges();
  }

  it('lets an admin edit an open tour and write its report', () => {
    open(makeTour());
    expect(extras.isAdmin()).toBe(true);
    expect(extras.canEdit()).toBe(true);
    expect(extras.canWriteReport()).toBe(true);
    expect(extras.canClose()).toBe(false); // it has not happened yet
    expect(extras.pdfUrl()).toBe(`${API}/tours/t1/pdf`);
    expect(extras.reportPdfUrl()).toBe(`${API}/tours/t1/report/pdf`);
    expect(extras.documentUrl('d1')).toBe(`${API}/documents/d1/file`);
  });

  it('offers the finished report for download', () => {
    open(makeTour(), 'member', {
      data: { canDownload: true, publishedAt: '2026-01-01', report: { status: 'final' } },
    });
    expect(extras.reportDownload()).toEqual({ publishedAt: '2026-01-01' });
    expect(extras.canWriteReport()).toBe(false);
  });

  it('keeps the report of a closed tour writable until it is finished', () => {
    open(makeTour({ closed: true }), 'admin', {
      data: { canDownload: false, report: { status: 'draft' } },
    });
    expect(extras.canEdit()).toBe(false);
    expect(extras.canWriteReport()).toBe(true);
    extras.loadReportInfo();
    respond({
      'GET /tours/t1/report': { data: { canDownload: false, report: { status: 'final' } } },
    });
    expect(extras.canWriteReport()).toBe(false);
    extras.loadReportInfo();
    respond({ 'GET /tours/t1/report': fail() });
    expect(extras.reportDownload()).toBeNull();
  });

  it('closes a finished tour only after a yes', async () => {
    open(makeTour({ startDate: '2020-07-10T08:00:00' }));
    expect(extras.canClose()).toBe(true);
    const closedAt: string[] = [];
    extras.tourClosed.subscribe((at) => closedAt.push(at));
    const confirm = TestBed.inject(ConfirmService);

    void extras.closeTour();
    expect(confirm.pending()?.message).toContain('„Mátra”');
    confirm.answer(false);
    await settle();
    http.expectNone(`${API}/tours/t1/close`);

    void extras.closeTour();
    confirm.answer(true);
    await settle();
    void extras.closeTour(); // already closing
    respond({ 'POST /tours/t1/close': { data: { closed: true, closedAt: '2026-01-02' } } });
    expect(closedAt).toEqual(['2026-01-02']);
    expect(success).toHaveBeenCalledWith('A tábor le van zárva');

    void extras.closeTour();
    confirm.answer(true);
    await settle();
    respond({ 'POST /tours/t1/close': fail(400, 'Még tart a tábor.') });
    expect(error).toHaveBeenCalledWith('Még tart a tábor.');
    expect(extras.closing()).toBe(false);
  });

  it('sends the programme booklet by e-mail', () => {
    open(makeTour());
    extras.sendPdfByEmail();
    extras.sendPdfByEmail();
    respond({ 'POST /tours/t1/pdf/email': { data: { sentTo: 'a@b.hu' } } });
    expect(success).toHaveBeenCalledWith('Programfüzet elküldve: a@b.hu');
    extras.sendPdfByEmail();
    respond({ 'POST /tours/t1/pdf/email': fail() });
    expect(error).toHaveBeenCalledWith('Hiba történt a küldés során.');
    expect(extras.emailingPdf()).toBe(false);
  });

  it('uploads a document, needing a title and a file', () => {
    open(makeTour({ extraDocuments: [DOC] }));
    const changes: unknown[][] = [];
    extras.documentsChanged.subscribe((docs) => changes.push(docs));
    extras.startAddDocument();
    fixture.detectChanges();
    extras.saveNewDocument();
    expect(error).toHaveBeenCalledWith('A dokumentumnak kell legyen címe.');
    extras.newDocumentTitle = ' Házirend ';
    extras.saveNewDocument();
    expect(error).toHaveBeenCalledWith('Válassz ki egy PDF, JPG vagy PNG fájlt.');

    extras.onDocumentFileSelected({
      target: { files: [new File(['x'], 'h.pdf')] },
    } as unknown as Event);
    extras.saveNewDocument();
    const req = http.expectOne(`${API}/documents`);
    expect(formEntries(req.request.body)).toEqual({ name: 'Házirend', tour: 't1', file: 'h.pdf' });
    req.flush({
      data: {
        document: { _id: 'd2', name: 'Házirend', filename: 'h.pdf', mimeType: 'application/pdf' },
      },
    });
    expect(changes[0]).toHaveLength(2);
    expect(extras.addingDocument()).toBe(false);

    extras.startAddDocument();
    extras.newDocumentTitle = 'Kép';
    extras.onDocumentFileSelected({
      target: { files: [new File(['x'], 'k.gif')] },
    } as unknown as Event);
    extras.saveNewDocument();
    respond({ 'POST /documents': fail(400, 'Csak PDF, JPG vagy PNG.') });
    expect(error).toHaveBeenCalledWith('Csak PDF, JPG vagy PNG.');
    extras.cancelAddDocument();
    expect(extras.addingDocument()).toBe(false);
  });

  it('deletes a document only after a yes', async () => {
    open(makeTour({ extraDocuments: [DOC] }));
    const changes: unknown[][] = [];
    extras.documentsChanged.subscribe((docs) => changes.push(docs));
    const confirm = TestBed.inject(ConfirmService);
    const click = new Event('click');

    void extras.askDeleteDocument(DOC, click);
    confirm.answer(false);
    await settle();
    http.expectNone(`${API}/documents/d1`);

    void extras.askDeleteDocument(DOC, click);
    confirm.answer(true);
    await settle();
    void extras.askDeleteDocument(DOC, click); // already deleting
    respond({ 'DELETE /documents/d1': {} });
    expect(changes).toEqual([[]]);
    expect(success).toHaveBeenCalledWith('Dokumentum törölve');

    void extras.askDeleteDocument(DOC, click);
    confirm.answer(true);
    await settle();
    respond({ 'DELETE /documents/d1': fail() });
    expect(error).toHaveBeenCalledWith('Hiba történt a törlés során.');
    expect(extras.deletingDocument()).toBe(false);
  });
});

describe('TourMailPanel', () => {
  let fixture: ComponentFixture<TourMailPanel>;
  let panel: TourMailPanel;
  const quill = () => (panel as unknown as { quill: Quill }).quill;
  const mailing = {
    _id: 'm1',
    subject: 'Régi',
    html: '<p>régi</p>',
    withPdf: true,
    recipientCount: 5,
  };

  const mailings = (draft: object | null = null) => ({
    data: {
      draft,
      sent: [mailing],
      recipients: { eligible: ['Teszt Elek'], skipped: [{ name: 'Kata', reason: 'nincs e-mail' }] },
      defaults: { subject: '12. Bódorgó – Mátra', withPdf: true },
    },
  });

  function open(reply: object = mailings()) {
    fixture = TestBed.createComponent(TourMailPanel);
    panel = fixture.componentInstance;
    fixture.componentRef.setInput('tourId', 't1');
    fixture.detectChanges();
    respond({ 'GET /tours/t1/mailings': reply });
    fixture.detectChanges();
  }

  /** Types into the editor the way a user would. */
  const type = (text: string) => quill().insertText(0, text, 'user');

  it('starts an empty letter with the default subject', () => {
    open();
    expect(panel.loading()).toBe(false);
    expect(panel.subject()).toBe('12. Bódorgó – Mátra');
    expect(panel.withPdf()).toBe(true);
    expect(panel.isEmpty()).toBe(true);
    expect(panel.recipients().eligible).toEqual(['Teszt Elek']);
    expect(panel.sent()).toHaveLength(1);
    expect(panel.sentHtml(panel.sent()[0])).toBeTruthy();
    panel.toggleSent(panel.sent()[0]);
    expect(panel.openSentId()).toBe('m1');
    panel.toggleSent(panel.sent()[0]);
    expect(panel.openSentId()).toBeNull();
  });

  it('continues a saved draft', () => {
    open(
      mailings({
        subject: 'Hideg lesz',
        html: '<p>Hozz pulóvert!</p>',
        delta: null,
        updatedAt: '2026-01-01',
      }),
    );
    expect(panel.subject()).toBe('Hideg lesz');
    expect(panel.isEmpty()).toBe(false);
    expect(panel.savedAt()).not.toBeNull();
    expect(quill().getText()).toContain('Hozz pulóvert!');
  });

  it('reports a failed load', () => {
    open(fail(403, 'Nincs jogod.'));
    expect(error).toHaveBeenCalledWith('Nincs jogod.');
    expect(panel.loading()).toBe(false);
  });

  it('saves the draft before closing', async () => {
    open();
    const closed = vi.fn();
    panel.closed.subscribe(closed);
    type('Hozz esőkabátot!');
    panel.onSubjectChange('Esős idő');
    expect(panel.saveState()).toBe('pending');
    expect(panel.isEmpty()).toBe(false);

    const closing = panel.close();
    await settle();
    const req = http.expectOne(`${API}/tours/t1/mailings/draft`);
    expect(req.request.body.subject).toBe('Esős idő');
    expect(req.request.body.html).toContain('esőkabátot!');
    req.flush({ data: { updatedAt: '2026-02-02T10:00:00Z' } });
    await closing;
    expect(panel.saveState()).toBe('saved');
    expect(closed).toHaveBeenCalled();
  });

  it('shows a preview of the letter', () => {
    open();
    type('Szia!');
    panel.togglePreview();
    expect(panel.showPreview()).toBe(true);
    expect(String(panel.previewHtml())).toContain('Szia!');
    panel.togglePreview();
    expect(panel.showPreview()).toBe(false);
  });

  it('does not send an empty letter', async () => {
    open();
    await panel.sendTest();
    panel.askSend();
    expect(panel.confirming()).toBe(false);
    http.expectNone(`${API}/tours/t1/mailings/test`);
  });

  it('sends a test letter to the admin, saving the draft first', async () => {
    open();
    type('Szia!');
    const sending = panel.sendTest();
    await settle();
    respond({ 'PUT /tours/t1/mailings/draft': { data: { updatedAt: '2026-02-02' } } });
    await settle();
    const req = http.expectOne(`${API}/tours/t1/mailings/test`);
    expect(req.request.body).toEqual({ withPdf: true });
    req.flush({ data: { sentTo: 'a@b.hu' } });
    await sending;
    expect(success).toHaveBeenCalledWith('Próbalevél elküldve: a@b.hu');
    expect(panel.sendingTest()).toBe(false);
  });

  it('reports a test letter that could not be sent, and retries a failed draft save', async () => {
    open();
    type('Szia!');
    const sending = panel.sendTest();
    await settle();
    respond({ 'PUT /tours/t1/mailings/draft': fail() });
    await settle();
    expect(panel.saveState()).toBe('error');
    respond({ 'POST /tours/t1/mailings/test': fail(500, 'Nincs SMTP.') });
    await sending;
    expect(error).toHaveBeenCalledWith('Nincs SMTP.');
  });

  it('sends the letter and starts a fresh one', async () => {
    open();
    type('Szia!');
    panel.askSend();
    expect(panel.confirming()).toBe(true);
    const sending = panel.send();
    await settle();
    respond({ 'PUT /tours/t1/mailings/draft': { data: { updatedAt: '2026-02-02' } } });
    await settle();
    respond({ 'POST /tours/t1/mailings/send': { data: { mailing: { ...mailing, _id: 'm2' } } } });
    await sending;

    expect(success).toHaveBeenCalledWith('Levél elküldve 5 résztvevőnek.');
    expect(panel.sent().map((m) => m._id)).toEqual(['m2', 'm1']);
    expect(panel.openSentId()).toBe('m2');
    expect(panel.isEmpty()).toBe(true);
    expect(panel.withPdf()).toBe(false); // the booklet went out with this one
    expect(panel.subject()).toBe('12. Bódorgó – Mátra');
    expect(panel.confirming()).toBe(false);
    expect(quill().getText().trim()).toBe('');
  });

  it('keeps the letter when sending fails', async () => {
    open();
    type('Szia!');
    const sending = panel.send();
    await settle();
    respond({ 'PUT /tours/t1/mailings/draft': { data: { updatedAt: '2026-02-02' } } });
    await settle();
    respond({ 'POST /tours/t1/mailings/send': fail(500, 'Nincs címzett.') });
    await sending;
    expect(error).toHaveBeenCalledWith('Nincs címzett.');
    expect(panel.isEmpty()).toBe(false);
    expect(panel.sending()).toBe(false);
  });
});

describe('TourReportPanel', () => {
  let fixture: ComponentFixture<TourReportPanel>;
  let panel: TourReportPanel;
  const quills = () => (panel as unknown as { quills: Quill[] }).quills;

  const report = (over = {}) => ({
    status: 'draft',
    days: [{ ops: [{ insert: 'Megérkeztünk.\n' }] }, null, null],
    dayLabels: ['1. nap', '2. nap', '3. nap'],
    facts: { place: 'Mátraháza', dates: 'júl. 10–12.', headcount: '14 fő' },
    auto: { place: 'Mátraháza', dates: 'júl. 10–12.', headcount: '14 fő' },
    photo: null,
    updatedAt: '2026-01-01T10:00:00Z',
    updatedByName: 'Gazda',
    published: null,
    ...over,
  });

  async function open(reply: object = { data: { canDownload: false, report: report() } }) {
    fixture = TestBed.createComponent(TourReportPanel);
    panel = fixture.componentInstance;
    fixture.componentRef.setInput('tourId', 't1');
    fixture.componentRef.setInput('images', [
      { filename: 'a.jpg', width: 10, height: 10, size: 1, restricted: false },
    ]);
    fixture.detectChanges();
    respond({ 'GET /tours/t1/report': reply });
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('opens the report with an editor for each day', async () => {
    await open();
    expect(panel.loading()).toBe(false);
    expect(quills()).toHaveLength(3);
    expect(panel.filledDays()).toEqual([true, false, false]);
    expect(panel.hasText()).toBe(true);
    expect(panel.isFinal()).toBe(false);
    expect(panel.facts().headcount).toBe('14 fő');
    expect(panel.thumbUrl('a.jpg')).toBe(`${API}/tours/t1/images/a.jpg/thumb`);
  });

  it('has nothing to edit when there is no report, and reports a failed load', async () => {
    await open({ data: { canDownload: false } });
    expect(panel.report()).toBeNull();
    expect(panel.loading()).toBe(false);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    error = vi.spyOn(TestBed.inject(NotificationsService), 'addError').mockImplementation(() => {});
    await open(fail(403, 'Nincs jogod.'));
    expect(error).toHaveBeenCalledWith('Nincs jogod.');
  });

  it('saves the text, the facts and the photo before closing', async () => {
    await open();
    const closed = vi.fn();
    panel.closed.subscribe(closed);
    quills()[1].insertText(0, 'Kirándultunk.', 'user');
    panel.setFact('headcount', '15 fő');
    panel.pickPhoto('a.jpg');
    expect(panel.saveState()).toBe('pending');
    expect(panel.filledDays()).toEqual([true, true, false]);

    const closing = panel.close();
    await settle();
    const req = TestBed.inject(HttpTestingController).expectOne(`${API}/tours/t1/report`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.facts.headcount).toBe('15 fő');
    expect(req.request.body.photo).toBe('a.jpg');
    expect(req.request.body.days[2]).toBeNull();
    expect(JSON.stringify(req.request.body.days[1])).toContain('Kirándultunk.');
    req.flush({ data: { updatedAt: '2026-02-02T10:00:00Z' } });
    await closing;
    expect(panel.saveState()).toBe('saved');
    expect(closed).toHaveBeenCalled();
  });

  it('unpicks a photo on a second click', async () => {
    await open();
    panel.pickPhoto('a.jpg');
    panel.pickPhoto('a.jpg');
    expect(panel.photo()).toBeNull();
  });

  it('marks the report as finished, which locks it', async () => {
    await open();
    const changed = vi.fn();
    panel.changed.subscribe(changed);
    success = vi
      .spyOn(TestBed.inject(NotificationsService), 'addSuccess')
      .mockImplementation(() => {});
    panel.askFinish();
    expect(panel.confirming()).toBe(true);
    const finishing = panel.finish();
    void panel.finish(); // already under way
    await settle();
    respond({ 'POST /tours/t1/report/finish': { data: { report: report({ status: 'final' }) } } });
    await finishing;

    expect(panel.isFinal()).toBe(true);
    expect(panel.confirming()).toBe(false);
    expect(changed).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith('A beszámoló kész - a résztvevők letölthetik.');
    expect(quills()[0].isEnabled()).toBe(false);

    // locked: nothing can be changed or saved any more
    panel.pickPhoto('a.jpg');
    panel.setFact('place', 'Máshol');
    expect(panel.photo()).toBeNull();
    expect(panel.saveState()).toBe('idle');

    const reopening = panel.reopen();
    respond({ 'POST /tours/t1/report/reopen': { data: { report: report() } } });
    await reopening;
    expect(panel.isFinal()).toBe(false);
    expect(quills()[0].isEnabled()).toBe(true);
  });

  it('cannot finish an empty report, and reports failures', async () => {
    await open({ data: { canDownload: false, report: report({ days: [null, null, null] }) } });
    panel.askFinish();
    expect(panel.confirming()).toBe(false);

    error = vi.spyOn(TestBed.inject(NotificationsService), 'addError').mockImplementation(() => {});
    const finishing = panel.finish();
    await settle();
    respond({ 'POST /tours/t1/report/finish': fail(400, 'Üres a beszámoló.') });
    await finishing;
    expect(error).toHaveBeenCalledWith('Üres a beszámoló.');

    const reopening = panel.reopen();
    respond({ 'POST /tours/t1/report/reopen': fail() });
    await reopening;
    expect(error).toHaveBeenCalledWith('Nem sikerült visszanyitni.');
    expect(panel.busy()).toBe(false);
  });
});
