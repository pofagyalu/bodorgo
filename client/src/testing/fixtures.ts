import { WeatherOutlookRules } from '../app/services/settings';
import { AttendeePayment, Tour, TourResponse, WeatherOutlook } from '../app/services/tour';

// A tour's weather outlook as the server sends it (mixed, two days out).
export function makeWeatherOutlook(over: Partial<WeatherOutlook> = {}): WeatherOutlook {
  return {
    score: 63,
    tier: 'mixed',
    tag: 'Vegyesfelvágott',
    word: 'Elmegy',
    headline: 'Lesz itt minden, mint a búcsúban',
    lines: ['A leggyengébb napnak a szombat ígérkezik: eső, 6 és 15 °C között.'],
    note: null,
    pack: [
      { icon: 'sweater', name: 'Meleg pulóver', why: 'Estére 6 °C-ra hűl a levegő' },
      { icon: 'umbrella', name: 'Esőkabát vagy esernyő', why: 'Egy napon várható csapadék' },
    ],
    frozen: false,
    ...over,
  };
}

// The weather outlook's rules as the server hands them out (its settings
// file as it stood when the outlook was built).
export function makeWeatherRules(): WeatherOutlookRules {
  return {
    forecast: { daysAhead: 15, refetchHours: 6 },
    settings: {
      conditionScore: {
        clear: 100,
        'partly-cloudy': 85,
        cloudy: 65,
        fog: 50,
        snow: 35,
        rain: 25,
        thunderstorm: 10,
      },
      wetConditions: ['rain', 'snow', 'thunderstorm'],
      sunnyConditions: ['clear', 'partly-cloudy'],
      rainChanceSoftening: 0.5,
      defaultRainChance: 80,
      wetRainChance: 40,
      comfortByMonth: [
        [3, 12],
        [5, 14],
        [10, 20],
        [15, 24],
        [18, 25],
        [20, 27],
        [21, 28],
        [21, 28],
        [18, 25],
        [14, 23],
        [8, 18],
        [3, 12],
      ],
      comfortFadeBelow: 13,
      comfortFadeAbove: 8,
      weights: { condition: 0.6, temperature: 0.4, average: 0.7, worstDay: 0.3 },
      tiers: { perfect: 85, great: 70, mixed: 50, gloomy: 30 },
      uncertainAfterDays: 5,
      allGoodFrom: 85,
      bestDayLead: 10,
      packing: {
        tshirtFromMaxC: 20,
        sweaterBelowMinC: 12,
        jacketBelowMinC: 6,
        beanieFromMinC: 0,
        sunFromMaxC: 22,
        sunnyDayFromMaxC: 20,
        layersFromSpreadC: 12,
        windFromKmh: 30,
      },
    },
    tiers: [
      { tier: 'rough', from: 0, to: 30, tag: 'Durva idő', word: 'Pálinkás' },
      { tier: 'gloomy', from: 30, to: 50, tag: 'Szürke idő', word: 'Boros' },
      { tier: 'mixed', from: 50, to: 70, tag: 'Vegyesfelvágott', word: 'Elmegy' },
      { tier: 'great', from: 70, to: 85, tag: 'Kirándulóidő', word: 'Sörös' },
      { tier: 'perfect', from: 85, to: 100, tag: 'Napszemüveges idő', word: 'Koktélos' },
    ],
    conditionNames: {
      clear: 'napsütés',
      'partly-cloudy': 'változó felhőzet',
      cloudy: 'felhős ég',
      fog: 'köd',
      rain: 'eső',
      snow: 'havazás',
      thunderstorm: 'zivatar',
    },
    packNames: {
      tshirt: 'Póló',
      sweater: 'Meleg pulóver',
      jacket: 'Meleg kabát',
      beanie: 'Sapka, kesztyű',
      umbrella: 'Esőkabát vagy esernyő',
      wind: 'Széldzseki',
      sun: 'Napszemüveg, naptej',
      layers: 'Réteges öltözet',
    },
  };
}

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
        bookedBy: { _id: 'me', name: 'Teszt Elek' },
        attendees: [
          { user: 'me', name: 'Teszt Elek' },
          { user: 'kid', name: 'Teszt Kata' },
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
