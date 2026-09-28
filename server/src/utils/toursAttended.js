import Reservation from '../models/reservationModel.js';
import Tour from '../models/tourModel.js';

// How many tours someone has been on: distinct tours they're an attendee
// of that have already started - a sign-up for a tour still ahead doesn't
// count yet. The one count behind the Táborok column, Profilom and the
// medals (bronz 10, ezüst 20, arany 30, platina 40, gyémánt 50 - see the
// client's shared/tour-medal.ts), so they always agree.

async function startedTourIds(now = new Date()) {
  return (await Tour.find({ startDate: { $lte: now } }).select('_id')).map((t) => t._id);
}

// userId (string) -> count, for everyone with at least one.
export async function toursAttendedByUser(now = new Date()) {
  const counts = await Reservation.aggregate([
    { $match: { tour: { $in: await startedTourIds(now) } } },
    { $unwind: '$attendees' },
    { $group: { _id: '$attendees.user', tours: { $addToSet: '$tour' } } },
    { $project: { toursAttended: { $size: '$tours' } } },
  ]);
  return new Map(counts.map((a) => [String(a._id), a.toursAttended]));
}

export async function toursAttendedOf(userId, now = new Date()) {
  const counts = await Reservation.aggregate([
    { $match: { tour: { $in: await startedTourIds(now) } } },
    { $unwind: '$attendees' },
    { $match: { 'attendees.user': userId } },
    { $group: { _id: '$tour' } },
    { $count: 'toursAttended' },
  ]);
  return counts[0]?.toursAttended ?? 0;
}
