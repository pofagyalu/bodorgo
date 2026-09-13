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
  const tour = await Tour.findById(req.params.id).populate({
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
  //
  // 1️⃣ Get tour-level stats (ratings, num tours, etc.)
  //
  const tourStats = await Tour.aggregate([
    {
      $match: { ratingsAverage: { $gte: 4.5 } },
    },
    {
      $group: {
        _id: null,
        numTours: { $sum: 1 },
        numRatings: { $sum: '$ratingsQuantity' },
        avgRating: { $avg: '$ratingsAverage' },
      },
    },
  ]);

  //
  // 2️⃣ Compute participant stats from Reservations
  //
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

  //
  // 3️⃣ Compute total participants and top tour
  //
  const totalParticipants = participantStats.reduce(
    (sum, t) => sum + t.totalParticipantsForTour,
    0,
  );

  const topTourId =
    participantStats.length > 0 ? participantStats[0]._id : null;

  //
  // 4️⃣ Merge into one final stats object
  //
  const result = {
    ...tourStats[0], // ratings + num tours
    totalParticipants, // new total from reservations
    topTourId, // new top tour from reservations
  };

  res.status(200).json({ status: 'success', data: { stats: result } });
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
