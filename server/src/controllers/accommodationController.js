import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';

// PUT /tours/:id/accommodation - admin-only. Replaces the tour's whole
// houses -> rooms list in one go, saved separately from the rest of the
// tour (the tour is usually created long before its rooms are known - see
// tour-edit's "Szállás" section). An existing house/room is sent back with
// its _id and keeps it (so the Szobabeosztás that points at a room by id
// survives a rename); a new one has no _id and gets a fresh one.
export const updateAccommodation = async (req, res) => {
  const query = mongoose.isValidObjectId(req.params.id)
    ? { _id: req.params.id }
    : { slug: req.params.id };
  const tour = await Tour.findOne(query);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const { houses } = req.body ?? {};
  if (!Array.isArray(houses)) {
    throw new AppError('Hibás szállás adatok.', 400);
  }

  const keepId = (id) => (id && mongoose.isValidObjectId(id) ? { _id: id } : {});
  tour.accommodation = {
    houses: houses.map((h) => ({
      ...keepId(h._id),
      name: h.name,
      description: h.description ?? '',
      rooms: (Array.isArray(h.rooms) ? h.rooms : []).map((r) => ({
        ...keepId(r._id),
        name: r.name,
        description: r.description ?? '',
        beds: r.beds,
      })),
    })),
  };

  // Validation errors (empty name, 0 beds...) come back as a 400 through
  // the global error handler, with the schema's Hungarian messages.
  await tour.save({ validateModifiedOnly: true });

  res.status(200).json({ status: 'success', data: { accommodation: tour.accommodation } });
};
