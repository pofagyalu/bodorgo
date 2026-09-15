import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import APIFeatures from '../utils/apiFeatures.js';
import AppError from '../utils/appError.js';
import { fetchForecast, fetchHistorical, MAX_FORECAST_DAYS_AHEAD } from '../utils/weather.js';
import logger from '../logger.js';

const WEATHER_REFETCH_HOURS = 6;

function toDateStr(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
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
          if (result) upsertDailyWeather(tour, day, { ...result, isFinal: true, fetchedAt: new Date() });
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
        if (result) upsertDailyWeather(tour, day, { ...result, isFinal: false, fetchedAt: new Date() });
      }),
    );
  }

  if (tasks.length) {
    await Promise.all(tasks);
    await tour.save();
  }
}

export const aliasLastTours = async (req, res, next) => {
  res.locals.queryOverride = {
    limit: 3,
    sort: '-order',
    // fields:
    //   'order title summary description startDate price participants maxCapactity ratingsAverage',
  };
  next();
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
  const tours = await features.query.populate('reservations');

  // Return total documents without any filters and so on
  const totalDocuments = await Tour.countDocuments();

  const toursWithCounts = tours.map((tour) => {
    const participantCount = tour.reservations.reduce(
      (sum, r) => sum + r.attendees.length,
      0,
    );
    return { ...tour.toObject(), participantCount };
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
    populate: { path: 'bookedBy', select: 'name email' },
  });

  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  await refreshTourWeather(tour);

  const participantCount = tour.reservations.reduce(
    (sum, r) => sum + r.attendees.length,
    0,
  );

  res.status(200).json({ status: 'success', data: { tour, participantCount } });
};

// order can't be safely auto-computed from the current max (most of the
// real ~32 historical tours aren't uploaded yet, see addTour.js), so it's
// required explicitly here too, with the same collision check that script
// already does.
export const createTour = async (req, res) => {
  if (req.body.order === undefined) {
    throw new AppError('A tábornak kell legyen sorszáma (order).', 400);
  }

  const existing = await Tour.findOne({ order: req.body.order }).select('title');
  if (existing) {
    throw new AppError(`A ${req.body.order}. sorszám már foglalt ("${existing.title}").`, 400);
  }

  const newTour = await Tour.create(req.body);

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

  for (const [key, value] of Object.entries(req.body)) {
    tour[key] = value;
  }
  await tour.save();

  res.status(200).json({ status: 'success', data: { tour } });
};

export const deleteTour = async (req, res) => {
  // Same id-or-slug resolution as getTour/updateTour.
  const query = mongoose.isValidObjectId(req.params.id)
    ? { _id: req.params.id }
    : { slug: req.params.id };

  const tour = await Tour.findOneAndDelete(query);

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

// Lets the current user opt in or out of an optional schedule event
// (e.g. a wine tasting with an extra cost) - anytime, either direction.
// Never trusts a client-supplied identity, same principle as the chat
// feature's create-post and the tour signup endpoint.
export const toggleScheduleParticipation = async (req, res) => {
  const { tourId, eventId } = req.params;

  const tour = await Tour.findById(tourId);
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

  const existingIndex = event.participants.findIndex(
    (p) => p.user.toString() === req.user._id.toString(),
  );

  let joined;
  if (existingIndex >= 0) {
    event.participants.splice(existingIndex, 1);
    joined = false;
  } else {
    event.participants.push({ user: req.user._id, name: req.user.name });
    joined = true;
  }

  await tour.save();

  res.status(200).json({
    status: 'success',
    data: { joined, participants: event.participants },
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

  const { time, description, isOptional, extraCost } = req.body;
  if (time !== undefined) event.time = time;
  if (description !== undefined) event.description = description;
  if (isOptional !== undefined) event.isOptional = isOptional;
  // extraCost only means anything for an optional event - clearing it when
  // isOptional turns off avoids a stale price lingering on a now-required
  // event (see tourModel.js's schedule.extraCost comment).
  event.extraCost = isOptional ? extraCost : undefined;

  await tour.save();

  res.status(200).json({ status: 'success', data: { event } });
};

export const getTourStats = async (req, res) => {
  // Was previously $match: { ratingsAverage: { $gte: 4.5 } } before counting
  // - a leftover from this codebase's Natours-tutorial origins where the
  // endpoint meant "stats for well-rated tours", not "total tours". Since
  // ratingsAverage defaults to 4.5 for any never-rated tour, that filter
  // silently passed almost everything by accident, but would undercount
  // the moment a real tour got rated below 4.5. countDocuments() goes
  // through the same pre(/^find/) secretTour-exclusion middleware as
  // getAlltours's own totalDocuments count.
  const totalTours = await Tour.countDocuments();

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

  res.status(200).json({
    status: 'success',
    data: {
      totalTours,
      totalParticipants,
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
