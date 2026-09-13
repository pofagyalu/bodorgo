import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import APIFeatures from '../utils/apiFeatures.js';
import AppError from '../utils/appError.js';
import { computeDrivingDistanceKm, BUDAPEST_CENTER } from '../utils/distance.js';
import logger from '../logger.js';

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

  const participantCount = tour.reservations.reduce(
    (sum, r) => sum + r.attendees.length,
    0,
  );

  res.status(200).json({ status: 'success', data: { tour, participantCount } });
};

export const createTour = async (req, res) => {
  const newTour = await Tour.create(req.body);

  if (!newTour) {
    throw new AppError('Invalid data sent', 404);
  }

  res.status(201).json({ status: 'success', data: { tour: newTour } });
};

export const updateTour = async (req, res) => {
  // findByIdAndUpdate bypasses the model's pre('save') hook, so the cached
  // distance has to be refreshed here explicitly - only when coordinates
  // are actually part of this update, never on every unrelated edit.
  const coords = req.body?.location?.coordinates;
  if (Array.isArray(coords) && coords.length === 2) {
    try {
      req.body.distanceFromBudapestKm = await computeDrivingDistanceKm(
        BUDAPEST_CENTER,
        { lat: coords[1], lng: coords[0] },
      );
    } catch (err) {
      logger.error(`Failed to compute distance from Budapest: ${err.message}`);
    }
  }

  const tour = await Tour.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  res.status(200).json({ status: 'success', data: { tour } });
};

export const deleteTour = async (req, res) => {
  const tour = await Tour.findByIdAndDelete(req.params.id);

  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  res.status(204).json({ status: 'success', data: null });
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
