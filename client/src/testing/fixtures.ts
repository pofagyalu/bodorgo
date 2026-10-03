import { AttendeePayment, Tour, TourResponse } from '../app/services/tour';

/** A three-day camp next summer, with two programme items. */
export function makeTour(over: Partial<Tour> = {}): Tour {
  const year = new Date().getFullYear() + 1;
  return {
    _id: 't1',
    order: 12,
    title: 'Mátra',
    slug: 'matra',
    location: {
      description: 'Mátraháza',
      type: 'Point',
      coordinates: [19.97, 47.87],
      address: 'Mátraháza, Fő út 1.',
    },
    coordinates: '47.87, 19.97',
    startDate: `${year}-07-10T08:00:00.000Z`,
    duration: 3,
    participants: 0,
    maxCapacity: 20,
    ratingsAverage: 8.5,
    ratingsQuantity: 4,
    summary: 'Hegyi tábor',
    description: 'Leírás',
    images: [],
    schedule: [
      { _id: 'e1', day: 1, time: '10:00', description: 'Érkezés' },
      {
        _id: 'e2',
        day: 2,
        time: '09:00',
        description: 'Kalandpark',
        isOptional: true,
        extraCost: 4000,
        participants: [{ user: 'me', name: 'Teszt Elek' }],
      },
    ],
    reservations: [
      {
        _id: 'r1',
        bookedBy: { _id: 'me', name: 'Teszt Elek', email: 'elek@x.hu' },
        attendees: [
          { user: 'me', name: 'Teszt Elek' },
          { user: { _id: 'kid' }, name: 'Teszt Kata' },
        ],
        paid: false,
      },
    ],
    extraDocuments: [],
    ...over,
  };
}

export function makePayment(over: Partial<AttendeePayment> = {}): AttendeePayment {
  return {
    reservationId: 'r1',
    attendeeId: 'a-me',
    name: 'Teszt Elek',
    nights: 2,
    familyId: 'f1',
    userId: 'me',
    paid: false,
    feeExempt: false,
    totalPrice: 20000,
    advance: 6000,
    advanceInCurrency: 6000,
    rest: 14000,
    paymentId: null,
    paymentMethod: null,
    ...over,
  };
}

/** The answer of GET /tours/:id around a tour. */
export function tourResponse(tour: Tour, over: Partial<TourResponse['data']> = {}): TourResponse {
  return {
    status: 'success',
    data: {
      tour,
      hasVideo: false,
      videos: [],
      participantCount: 2,
      attendeePayments: [
        makePayment(),
        makePayment({ attendeeId: 'a-kid', name: 'Teszt Kata', userId: 'kid' }),
      ],
      paymentTotals: { totalPrice: 40000, advance: 12000, advanceInCurrency: 12000, rest: 28000 },
      distanceInfo: { distanceKm: 100, durationMinutes: 95, fromLabel: 'Budapest' },
      userPhotos: {},
      usernames: {},
      ...over,
    },
  };
}
