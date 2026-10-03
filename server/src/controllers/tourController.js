import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import User from '../models/userModel.js';
import Payment from '../models/paymentModel.js';
import { FutokorCourse, FutokorRun } from '../models/futokorModels.js';
import { computeAttendeePayments, markAllAttendeesPaidForTour } from './reservationController.js';
import { tourHasEnded } from './reviewController.js';
import { computeAge } from './userController.js';
import { tourVideoList } from '../utils/tourVideos.js';
import APIFeatures from '../utils/apiFeatures.js';
import AppError from '../utils/appError.js';
import logger from '../logger.js';
import { fetchForecast, fetchHistorical, MAX_FORECAST_DAYS_AHEAD } from '../utils/weather.js';
import { resolveDistanceInfo } from '../utils/distance.js';
import { tourDocuments } from './documentController.js';
import { cleanOnSitePayment } from '../utils/onSitePayment.js';

const WEATHER_REFETCH_HOURS = 6;

// YYYY-MM-DD of the date's own calendar day (server local time). Not
// toISOString(): the tour days are local midnights, which in Hungary are
// still the PREVIOUS day in UTC - that asked Open-Meteo for the day before
// every tour day.
export function toDateStr(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function upsertDailyWeather(tour, day, data) {
  const idx = tour.dailyWeather.findIndex((w) => w.day === day);
  if (idx >= 0) {
    Object.assign(tour.dailyWeather[idx], data);
  } else {
    tour.dailyWeather.push({ day, ...data });
  }
}

// Called on every getTour - forecasts a tour's still-upcoming days
// (throttled so repeat page views don't re-hit the API every time), and
// once a day has passed, fetches the real recorded weather for it exactly
// once and freezes it (isFinal) forever after. Never blocks the tour from
// loading if Open-Meteo is unreachable - fetchForecast/fetchHistorical
// already swallow their own errors and return null.
async function refreshTourWeather(tour) {
  const coords = tour.location?.coordinates;
  if (coords?.length !== 2 || coords[0] == null || coords[1] == null) return;
  const [lng, lat] = coords;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tasks = [];

  for (let day = 1; day <= tour.duration; day++) {
    const existing = tour.dailyWeather.find((w) => w.day === day);
    if (existing?.isFinal) continue; // frozen, never touch again

    const date = new Date(tour.startDate);
    date.setDate(date.getDate() + (day - 1));
    date.setHours(0, 0, 0, 0);

    if (date <= today) {
      // One last fetch of what actually happened, then freeze forever.
      tasks.push(
        fetchHistorical(lat, lng, toDateStr(date)).then((result) => {
          if (result)
            upsertDailyWeather(tour, day, { ...result, isFinal: true, fetchedAt: new Date() });
        }),
      );
      continue;
    }

    const daysAhead = Math.round((date - today) / (24 * 60 * 60 * 1000));
    if (daysAhead > MAX_FORECAST_DAYS_AHEAD) continue; // beyond any free forecast horizon - nothing to fetch yet

    const staleMs = WEATHER_REFETCH_HOURS * 60 * 60 * 1000;
    if (existing?.fetchedAt && Date.now() - new Date(existing.fetchedAt).getTime() < staleMs) {
      continue; // fetched recently enough, skip
    }

    tasks.push(
      fetchForecast(lat, lng, toDateStr(date)).then((result) => {
        if (result)
          upsertDailyWeather(tour, day, { ...result, isFinal: false, fetchedAt: new Date() });
      }),
    );
  }

  if (tasks.length) {
    await Promise.all(tasks);
    await tour.save();
  }
}

// GET /tours/ticker - the only tour data a logged-out visitor ever gets:
// the landing page ticker's one line. The soonest tour that hasn't fully
// ended yet (start + duration still ahead) is "Következő"; if every tour
// has ended, the most recently started one is "Legutóbbi". Just the
// fields the ticker prints, nothing else.
export const getTicker = async (req, res) => {
  const tours = await Tour.find()
    .select('order title startDate duration location.description')
    .lean();

  const now = Date.now();
  const endOf = (t) => new Date(t.startDate).getTime() + (t.duration ?? 0) * 24 * 60 * 60 * 1000;
  const byStart = (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime();

  const upcoming = tours.filter((t) => t.startDate && endOf(t) > now).sort(byStart)[0];
  const latest = tours
    .filter((t) => t.startDate)
    .sort(byStart)
    .at(-1);
  const featured = upcoming ?? latest;

  res.status(200).json({
    status: 'success',
    data: featured
      ? {
          label: upcoming ? 'Következő' : 'Legutóbbi',
          order: featured.order,
          title: featured.title,
          place: featured.location?.description ?? '',
          startDate: featured.startDate,
        }
      : null,
  });
};

export const aliasLastTours = async (req, res, next) => {
  res.locals.queryOverride = {
    limit: 3,
    sort: '-order',
    // fields:
    //   'order title summary description startDate price participants maxCapactity ratingsAverage',
  };
  next();
};

// GET /tours/years - the years that had (or will have) a tour, oldest
// first. For the Táborok page's year filter, which lists them all without
// loading every tour.
export const getTourYears = async (req, res) => {
  const tours = await Tour.find().select('startDate').lean();
  const years = [...new Set(tours.map((t) => new Date(t.startDate).getFullYear()))].sort(
    (a, b) => a - b,
  );
  res.status(200).json({ status: 'success', data: { years } });
};

export const getAlltours = async (req, res) => {
  // 0) apply alias overrides if they exist
  const customQuery = {
    ...req.query,
    ...(res.locals.queryOverride || {}),
  };

  // EXECUTE QUERY
  const features = new APIFeatures(Tour.find(), customQuery)
    .filter()
    .sort()
    .limitFields()
    .paginate();
  // attendees.user needs role/birthday, not just its bare id, for
  // computeAttendeePayments below (club-subsidy eligibility and
  // perPerson child pricing respectively) - same populate shape getTour
  // already uses for the single-tour view.
  const tours = await features.query.populate({
    path: 'reservations',
    populate: [{ path: 'attendees.user', select: 'role birthday familyId' }],
  });

  // Return total documents without any filters and so on
  const totalDocuments = await Tour.countDocuments();

  const toursWithCounts = tours.map((tour) => {
    const participantCount = tour.reservations.reduce((sum, r) => sum + r.attendees.length, 0);

    // The advertised card price ("Ft/fő/éj") is normally a pre-
    // registration assumption (tourModel.js's pre('save') hook) - once
    // real people are actually registered, show the genuine average
    // instead (see computeAttendeePayments' averagePricePerPersonPerNight),
    // which can differ from that assumption in either direction (fewer
    // than maxCapacity attending pushes perHouse's true average up; any
    // attendee getting perPerson's child discount pulls it down).
    const { totals } = computeAttendeePayments(tour, tour.reservations);
    const price = totals?.averagePricePerPersonPerNight ?? tour.price;

    return { ...tour.toObject(), participantCount, price };
  });

  // SENDING RESPONSE
  res.status(200).json({
    status: 'success',
    results: toursWithCounts.length,
    totalDocuments: totalDocuments,
    data: { tours: toursWithCounts },
  });
};

export const getTour = async (req, res, next) => {
  // URLs use the slug (e.g. /taborok/erdobenye-sarospatak) for anything
  // shareable, but still accept a raw ObjectId too for links/scripts that
  // predate this - e.g. server/scripts/addTour.js prints the _id.
  const query = mongoose.isValidObjectId(req.params.id)
    ? { _id: req.params.id }
    : { slug: req.params.id };

  const tour = await Tour.findOne(query).populate({
    path: 'reservations',
    populate: [
      { path: 'bookedBy', select: 'name email' },
      // role decides club-subsidy eligibility; birthday decides
      // child/adult pricing in 'perPerson' mode; familyId lets the client
      // group/stripe the attendee list by family (see
      // computeAttendeePayments/attendee-list.ts) - name is already
      // denormalized onto the attendee subdocument itself, no need to
      // populate it too.
      { path: 'attendees.user', select: 'role birthday familyId' },
    ],
  });

  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  await refreshTourWeather(tour);

  const participantCount = tour.reservations.reduce((sum, r) => sum + r.attendees.length, 0);

  const { attendeePayments, totals: paymentTotals } = computeAttendeePayments(
    tour,
    tour.reservations,
  );

  // Which real Payment (if any) backs each attendee row - lets the admin
  // attendee-list tell a genuine Stripe/cash payment apart from a plain
  // paid flag with nothing behind it (legacy data, the 0%-advance
  // auto-mark), and specifically whether a cash entry can be safely
  // undone (see attendee-list.ts's cash toggle / paymentController.js's
  // deleteCashPayment, which only ever touches method: 'cash'). Same idea
  // as userController.js's getMyAttendance, just for every attendee on
  // this tour rather than just the caller's own.
  const tourPayments = await Payment.find({
    tour: tour._id,
    purpose: 'tourAdvance',
    status: 'Succeeded',
  }).select('_id method attendees.attendeeId');
  const paymentByAttendeeId = new Map();
  for (const payment of tourPayments) {
    for (const a of payment.attendees) {
      paymentByAttendeeId.set(String(a.attendeeId), {
        paymentId: String(payment._id),
        method: payment.method,
      });
    }
  }
  const attendeePaymentsWithMethod = attendeePayments.map((p) => ({
    ...p,
    paymentId: paymentByAttendeeId.get(p.attendeeId)?.paymentId ?? null,
    paymentMethod: paymentByAttendeeId.get(p.attendeeId)?.method ?? null,
  }));

  // Profile photo versions (see userModel.js's photoUpdatedAt) for everyone
  // shown on this tour's page - the attendee list and each program's
  // sign-ups - as one small { userId: photoUpdatedAt } lookup, only for
  // those who actually have a photo. One query here instead of populating
  // it separately into every attendee/participant subdocument.
  const shownUserIds = new Set(attendeePayments.map((p) => p.userId).filter(Boolean));
  for (const event of tour.schedule ?? []) {
    for (const p of event.participants ?? []) {
      if (p.user) shownUserIds.add(String(p.user));
    }
  }
  // Same lookup also returns usernames - the program sign-up chips show
  // someone's username instead of their full name when they've set one.
  const shownUsers = await User.find({
    _id: { $in: [...shownUserIds] },
    $or: [{ photoUpdatedAt: { $exists: true } }, { username: { $exists: true, $ne: '' } }],
  }).select('photoUpdatedAt username');
  const userPhotos = Object.fromEntries(
    shownUsers.filter((u) => u.photoUpdatedAt).map((u) => [String(u._id), u.photoUpdatedAt]),
  );
  const usernames = Object.fromEntries(
    shownUsers.filter((u) => u.username).map((u) => [String(u._id), u.username]),
  );

  // getTour is public (no requireAuth) so anonymous browsing still works -
  // this only personalizes the distance/duration/wording when a real
  // session is present, and falls back to the tour's own cached
  // Budapest-based figures otherwise (see resolveDistanceInfo).
  const viewer = req.session?.user?.id
    ? await User.findById(req.session.user.id).select('location address')
    : null;
  const distanceInfo = await resolveDistanceInfo(tour, viewer);

  // The recap video(s), found by the tour number (see utils/tourVideos.js)
  // - only ids and version names; playback goes through the
  // requireAuth-gated /tours/:id/videos/... routes.
  const tourJson = tour.toObject();
  // Its Extrák (Document collection - see documentController.js), in the
  // shape the tour page reads.
  tourJson.extraDocuments = (await tourDocuments(tour._id)).map((d) => ({
    _id: d._id,
    title: d.name,
    filename: d.filename,
    mimeType: d.mimeType,
  }));
  const videos = tourVideoList(tour.order);
  const hasVideo = videos.length > 0;

  res.status(200).json({
    status: 'success',
    data: {
      tour: tourJson,
      hasVideo,
      videos,
      participantCount,
      attendeePayments: attendeePaymentsWithMethod,
      paymentTotals,
      distanceInfo,
      userPhotos,
      usernames,
    },
  });
};

// order can't be safely auto-computed from the current max (most of the
// real ~32 historical tours aren't uploaded yet, see addTour.js), so it's
// required explicitly here too, with the same collision check that script
// already does.
// The tour form's Fizetési módok (onSitePayment) - only what it offers,
// cleaned (see utils/onSitePayment.js); the rest of the body as it is.
// ...and never the Lezárás fields: a tour is closed only through closeTour
// below, and opened again by nobody.
function withCleanOnSitePayment(body) {
  const { closed: _closed, closedAt: _closedAt, closedBy: _closedBy, ...rest } = body ?? {};
  if (rest.onSitePayment === undefined) return rest;
  return { ...rest, onSitePayment: cleanOnSitePayment(rest.onSitePayment) };
}

// POST /tours/:id/close - admin: Lezárás. One way only - from here on
// nothing about the tour can be changed (utils/tourClosed.js), and there is
// no endpoint that opens it again. Only once the tour is over.
export const closeTour = async (req, res) => {
  const query = mongoose.isValidObjectId(req.params.id)
    ? { _id: req.params.id }
    : { slug: req.params.id };
  const tour = await Tour.findOne(query).select('startDate duration closed');
  if (!tour) throw new AppError('No tour found with that ID!', 404);
  if (tour.closed) throw new AppError('Ez a tábor már le van zárva.', 400);
  if (!tourHasEnded(tour)) {
    throw new AppError('A tábor csak a vége után zárható le.', 400);
  }

  // Not .save(): only these three fields, whatever else the tour has.
  const closedAt = new Date();
  await Tour.updateOne({ _id: tour._id }, { closed: true, closedAt, closedBy: req.user._id });
  logger.info(`Tour ${tour._id} closed by ${req.user._id}`);

  res.status(200).json({ status: 'success', data: { closed: true, closedAt } });
};

export const createTour = async (req, res) => {
  if (req.body.order === undefined) {
    throw new AppError('A tábornak kell legyen sorszáma (order).', 400);
  }

  const existing = await Tour.findOne({ order: req.body.order }).select('title');
  if (existing) {
    throw new AppError(`A ${req.body.order}. sorszám már foglalt ("${existing.title}").`, 400);
  }

  const newTour = await Tour.create(withCleanOnSitePayment(req.body));

  if (!newTour) {
    throw new AppError('Invalid data sent', 404);
  }

  res.status(201).json({ status: 'success', data: { tour: newTour } });
};

// Loads and .save()s rather than findByIdAndUpdate, which bypasses the
// model's pre('save') hooks entirely - that used to mean a title change
// left the old slug in place, and location.coordinates changing needed its
// distance recomputed by hand here. Same approach as scripts/updateTour.js.
export const updateTour = async (req, res) => {
  // Same id-or-slug resolution as getTour - the edit page's link uses the
  // tour's slug, same as everywhere else in the app.
  const query = mongoose.isValidObjectId(req.params.id)
    ? { _id: req.params.id }
    : { slug: req.params.id };

  const tour = await Tour.findOne(query);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  if (req.body.order !== undefined && req.body.order !== tour.order) {
    const existing = await Tour.findOne({ order: req.body.order }).select('title');
    if (existing) {
      throw new AppError(`A ${req.body.order}. sorszám már foglalt ("${existing.title}").`, 400);
    }
  }

  for (const [key, value] of Object.entries(withCleanOnSitePayment(req.body))) {
    tour[key] = value;
  }

  // Captured before save() - Mongoose clears isModified's tracking for a
  // path once it's actually been saved. 0% advance is a real, deliberate
  // setting (a rare accommodation that genuinely needs no advance at
  // all) distinct from "not yet configured" (null/undefined) - see
  // markAllAttendeesPaidForTour's own comment on why that's worth an
  // automatic side effect.
  const advanceBecameZero =
    tour.isModified('advancePaymentPercentage') && tour.advancePaymentPercentage === 0;

  await tour.save();

  if (advanceBecameZero) {
    await markAllAttendeesPaidForTour(tour._id);
  }

  res.status(200).json({ status: 'success', data: { tour } });
};

export const deleteTour = async (req, res) => {
  // Same id-or-slug resolution as getTour/updateTour.
  const query = mongoose.isValidObjectId(req.params.id)
    ? { _id: req.params.id }
    : { slug: req.params.id };

  // A closed tour isn't deleted either (the route's tourOpen says so too).
  const tour = await Tour.findOneAndDelete({ ...query, closed: { $ne: true } });

  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  res.status(204).json({ status: 'success', data: null });
};

// Admin-only (see tourRoutes.js) - appends a brand new schedule event to a
// given day. Separate from updateScheduleEvent since there's no existing
// subdocument to look up yet.
export const createScheduleEvent = async (req, res) => {
  const { tourId } = req.params;
  const { day, time, description, isOptional, extraCost } = req.body;

  const tour = await Tour.findById(tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  if (day === undefined || !time || !description) {
    throw new AppError('A program elemnek kell legyen napja, időpontja és leírása.', 400);
  }

  tour.schedule.push({
    day,
    time,
    description,
    isOptional: !!isOptional,
    extraCost: isOptional ? extraCost : undefined,
  });

  await tour.save();

  const created = tour.schedule[tour.schedule.length - 1];
  res.status(201).json({ status: 'success', data: { event: created } });
};

// Lets the caller set exactly who among the people they're allowed to
// speak for is opted into an optional schedule event (e.g. an extra
// breakfast) - not just themselves: a member can cherry-pick specific
// family members (the two kids for the kids' breakfast, the two adults
// for the adults' one), same "self + same familyId" rule
// resolvePayableAttendees/assertCanRegister already use elsewhere; an
// admin can pick anyone actually attending this tour. Replaces exactly
// the caller's own editable subset of participants with the given list -
// anyone else's existing participation (outside that subset) is left
// untouched, so one family opting in/out never affects another's.
export const updateScheduleEventParticipants = async (req, res) => {
  const { tourId, eventId } = req.params;
  const { userIds } = req.body;

  if (!Array.isArray(userIds)) {
    throw new AppError('A userIds mezőnek tömbnek kell lennie.', 400);
  }

  const tour = await Tour.findById(tourId).populate({
    path: 'reservations',
    populate: [{ path: 'attendees.user', select: 'familyId' }],
  });
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const event = tour.schedule.id(eventId);
  if (!event) {
    throw new AppError('No such schedule event!', 404);
  }
  if (!event.isOptional) {
    throw new AppError('This event does not require opting in.', 400);
  }

  // Every real attendee of this tour, deduped by user id - the
  // denormalized name already on each attendee subdocument is reused
  // here rather than re-fetching User docs just for a display name.
  const attendeesById = new Map();
  for (const reservation of tour.reservations) {
    for (const a of reservation.attendees) {
      if (!a.user?._id) continue;
      const id = String(a.user._id);
      attendeesById.set(id, {
        name: a.name,
        familyId: a.user.familyId ? String(a.user.familyId) : null,
      });
    }
  }

  // Admin can toggle any real attendee; anyone else only themselves and
  // same-familyId attendees - never someone outside their own family.
  let editableIds;
  if (req.user.role === 'admin') {
    editableIds = new Set(attendeesById.keys());
  } else {
    const myFamilyId = req.user.familyId ? String(req.user.familyId) : null;
    editableIds = new Set(
      [...attendeesById.entries()]
        .filter(
          ([id, a]) => id === String(req.user._id) || (myFamilyId && a.familyId === myFamilyId),
        )
        .map(([id]) => id),
    );
  }

  const requestedIds = [...new Set(userIds.map(String))];
  const disallowed = requestedIds.filter((id) => !editableIds.has(id));
  if (disallowed.length) {
    throw new AppError(
      'Csak saját magadat és a hozzátartozóidat jelentkeztetheted erre az eseményre.',
      403,
    );
  }

  const keptParticipants = event.participants.filter((p) => !editableIds.has(String(p.user)));
  const newParticipants = requestedIds.map((id) => ({
    user: id,
    name: attendeesById.get(id).name,
  }));
  event.participants = [...keptParticipants, ...newParticipants];

  await tour.save();

  res.status(200).json({
    status: 'success',
    data: { participants: event.participants },
  });
};

// Admin-only (see tourRoutes.js) - fixes a schedule event's own details
// (time/description/isOptional/extraCost), not who's opted into it. Day is
// deliberately not editable here - moving an event between days is rare
// enough to not need a quick inline editor, and would require re-grouping
// it in the UI besides.
export const updateScheduleEvent = async (req, res) => {
  const { tourId, eventId } = req.params;

  const tour = await Tour.findById(tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const event = tour.schedule.id(eventId);
  if (!event) {
    throw new AppError('No such schedule event!', 404);
  }

  const { day, time, description, isOptional, extraCost } = req.body;
  // Moving it to another day (dragged there on the tour page): one of the
  // tour's days. Its time, price and the people who opted in come along.
  if (day !== undefined) {
    if (!Number.isInteger(day) || day < 1 || day > tour.duration) {
      throw new AppError(`A nap 1 és ${tour.duration} között legyen.`, 400);
    }
    event.day = day;
  }
  if (time !== undefined) event.time = time;
  if (description !== undefined) event.description = description;
  // extraCost only means anything for an optional event - clearing it when
  // isOptional turns off avoids a stale price lingering on a now-required
  // event (see tourModel.js's schedule.extraCost comment). A request that
  // says nothing about isOptional (a move to another day) leaves both.
  if (isOptional !== undefined) {
    event.isOptional = isOptional;
    event.extraCost = isOptional ? extraCost : undefined;
  }

  await tour.save();

  res.status(200).json({ status: 'success', data: { event } });
};

const oneDecimal = (n) => Math.round(n * 10) / 10;

// The homepage's age chart: how old the attendees were, tour by tour and
// year by year. Age is the one on the tour's first day (not today's), and
// only attendees with a birthday on file count (`count` of the `total`
// who were there). A year's average is over every such attendance of that
// year - so each tour weighs in by how many known ages it had, a big tour
// more than a small one. Tours nobody with a known age attended are left
// out, as are the years without such a tour.
async function attendeeAgeStats() {
  const tours = await Tour.find().select('title order slug startDate').sort('startDate');
  const attendances = await Reservation.aggregate([
    { $match: { tour: { $in: tours.map((t) => t._id) } } },
    { $unwind: '$attendees' },
    {
      $lookup: {
        from: 'users',
        localField: 'attendees.user',
        foreignField: '_id',
        as: 'attendeeUser',
      },
    },
    { $project: { tour: 1, birthday: { $first: '$attendeeUser.birthday' } } },
  ]);

  const newTally = () => ({ ageSum: 0, count: 0, total: 0, minAge: Infinity, maxAge: -Infinity });
  const addTo = (tally, other) => {
    tally.ageSum += other.ageSum;
    tally.count += other.count;
    tally.total += other.total;
    tally.minAge = Math.min(tally.minAge, other.minAge);
    tally.maxAge = Math.max(tally.maxAge, other.maxAge);
  };
  const figures = (tally) => ({
    averageAge: oneDecimal(tally.ageSum / tally.count),
    count: tally.count,
    total: tally.total,
    minAge: tally.minAge,
    maxAge: tally.maxAge,
  });

  const startDates = new Map(tours.map((t) => [String(t._id), t.startDate]));
  const byTour = new Map(); // tour id -> tally
  for (const a of attendances) {
    const id = String(a.tour);
    if (!byTour.has(id)) byTour.set(id, newTally());
    // A baby not yet one counts as 1 (in their first year), never as "0
    // év". A birthday after the tour is a mistake in the data - no age.
    const fullYears = computeAge(a.birthday, startDates.get(id));
    const age = fullYears === null || fullYears < 0 ? null : Math.max(1, fullYears);
    addTo(
      byTour.get(id),
      age === null
        ? { ...newTally(), total: 1 }
        : { ageSum: age, count: 1, total: 1, minAge: age, maxAge: age },
    );
  }

  const byYear = new Map(); // year -> tally
  const tourAges = [];
  for (const tour of tours) {
    const tally = byTour.get(String(tour._id));
    if (!tally?.count) continue;
    const year = tour.startDate.getFullYear();
    tourAges.push({
      title: tour.title,
      order: tour.order,
      slug: tour.slug,
      year,
      ...figures(tally),
    });
    if (!byYear.has(year)) byYear.set(year, newTally());
    addTo(byYear.get(year), tally);
  }

  return {
    tours: tourAges,
    years: [...byYear.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, tally]) => ({ year, ...figures(tally) })),
  };
}

// What the club has run on the futókörök, all time: every finished lap
// counts with its course's length (a lap on a course not measured yet
// counts as a lap, with no distance). Null until someone has finished one.
async function runningStats() {
  const [ran] = await FutokorRun.aggregate([
    { $match: { status: 'finished' } },
    {
      $lookup: {
        from: FutokorCourse.collection.name,
        localField: 'course',
        foreignField: '_id',
        as: 'course',
      },
    },
    { $unwind: '$course' },
    {
      $group: {
        _id: null,
        meters: { $sum: { $ifNull: ['$course.distanceM', 0] } },
        laps: { $sum: 1 },
        runners: { $addToSet: '$user' },
      },
    },
  ]);
  if (!ran) return null;
  return {
    totalKm: Math.round(ran.meters / 100) / 10,
    laps: ran.laps,
    runners: ran.runners.length,
  };
}

export const getTourStats = async (req, res) => {
  // Was previously $match: { ratingsAverage: { $gte: 4.5 } } before counting
  // - a leftover from this codebase's Natours-tutorial origins where the
  // endpoint meant "stats for well-rated tours", not "total tours". Since
  // ratingsAverage defaults to 4.5 for any never-rated tour, that filter
  // silently passed almost everything by accident, but would undercount
  // the moment a real tour got rated below 4.5. countDocuments() goes
  // through the same pre(/^find/) secretTour-exclusion middleware as
  // getAlltours's own totalDocuments count.
  //
  // Only tours that have already ended count ("N tábor eddig") - same
  // "ended" as the reviews (tourHasEnded); the ones still ahead are
  // counted separately, for the card's "+N hamarosan".
  const tourDates = await Tour.find().select('startDate duration');
  const totalTours = tourDates.filter((t) => tourHasEnded(t)).length;
  const upcomingTours = tourDates.length - totalTours;

  const participantStats = await Reservation.aggregate([
    { $unwind: '$attendees' }, // each attendee becomes its own doc
    {
      $group: {
        _id: '$tour',
        totalParticipantsForTour: { $sum: 1 },
      },
    },
    { $sort: { totalParticipantsForTour: -1 } },
  ]);

  const totalParticipants = participantStats.reduce(
    (sum, t) => sum + t.totalParticipantsForTour,
    0,
  );

  const topEntry = participantStats[0];
  const mostAttendedTourDoc = topEntry
    ? await Tour.findById(topEntry._id).select('title order slug')
    : null;

  // Quantity as a tiebreaker so a tour with one 5-star rating doesn't beat
  // one with a real track record of high ratings.
  const bestRatedTourDoc = await Tour.findOne()
    .sort('-ratingsAverage -ratingsQuantity')
    .select('title order slug ratingsAverage ratingsQuantity');

  // The gender split across every tour attendee on record (not every
  // registered user - plenty of those, e.g. login-less family members,
  // have never actually attended a tour). Attendees whose gender isn't
  // set are excluded rather than counted as a third bucket.
  const [genderAgg] = await Reservation.aggregate([
    { $unwind: '$attendees' },
    {
      $lookup: {
        from: 'users',
        localField: 'attendees.user',
        foreignField: '_id',
        as: 'attendeeUser',
      },
    },
    { $unwind: '$attendeeUser' },
    { $match: { 'attendeeUser.gender': { $in: ['férfi', 'nő'] } } },
    {
      $group: {
        _id: null,
        maleCount: { $sum: { $cond: [{ $eq: ['$attendeeUser.gender', 'férfi'] }, 1, 0] } },
        femaleCount: { $sum: { $cond: [{ $eq: ['$attendeeUser.gender', 'nő'] }, 1, 0] } },
      },
    },
  ]);

  // Rounding the two independently could land on e.g. 34/67 (101) - deriving
  // female as the remainder guarantees they always sum to 100.
  const malePercentage = genderAgg
    ? Math.round((genderAgg.maleCount / (genderAgg.maleCount + genderAgg.femaleCount)) * 100)
    : null;
  const genderRatio =
    malePercentage === null ? null : { malePercentage, femalePercentage: 100 - malePercentage };

  const attendeeAges = await attendeeAgeStats();

  res.status(200).json({
    status: 'success',
    data: {
      totalTours,
      upcomingTours,
      totalParticipants,
      genderRatio,
      attendeeAges,
      running: await runningStats(),
      mostAttendedTour: mostAttendedTourDoc
        ? {
            _id: mostAttendedTourDoc._id,
            title: mostAttendedTourDoc.title,
            order: mostAttendedTourDoc.order,
            slug: mostAttendedTourDoc.slug,
            participantCount: topEntry.totalParticipantsForTour,
          }
        : null,
      bestRatedTour: bestRatedTourDoc
        ? {
            _id: bestRatedTourDoc._id,
            title: bestRatedTourDoc.title,
            order: bestRatedTourDoc.order,
            slug: bestRatedTourDoc.slug,
            ratingsAverage: bestRatedTourDoc.ratingsAverage,
            ratingsQuantity: bestRatedTourDoc.ratingsQuantity,
          }
        : null,
    },
  });
};

export const getMonthlyPlan = async (req, res, next) => {
  const year = req.params.year * 1;
  const plan = await Tour.aggregate([
    {
      $unwind: '$startDate',
    },
    {
      $match: {
        startDate: {
          $gte: new Date(`${year}-01-01`),
          $lte: new Date(`${year}-12-31`),
        },
      },
    },
    {
      $group: {
        _id: { $month: '$startDate' },
        numTourStarts: { $sum: 1 },
        tours: { $push: '$startLocation.description' },
      },
    },
    {
      $addFields: { month: '$_id' },
    },
    {
      $project: {
        _id: 0,
      },
    },
    {
      $sort: { numTourStarts: -1 },
    },
    {
      $limit: 5,
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      plan,
    },
  });
};
