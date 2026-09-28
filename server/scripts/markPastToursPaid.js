// One-off clean-up (2026-09-28): every attendee of a tour that has already
// ended is marked as having paid their advance - the history before online
// and cash payments were recorded in the app. The same flag the admin's
// "0% advance" setting sets (reservationController.js's
// markAllAttendeesPaidForTour); no Payment/Transaction is invented.
//
// Dry run by default (only counts) - pass --apply to write.
// Runs against the local .env's database (bodorgo-dev); for production:
//   DB_TEST_URI="<live connection string>" node scripts/markPastToursPaid.js --apply
//
// Usage: node scripts/markPastToursPaid.js [--apply]
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Tour from '../src/models/tourModel.js';
import Reservation from '../src/models/reservationModel.js';
import { tourHasEnded } from '../src/controllers/reviewController.js';

const apply = process.argv.includes('--apply');
await mongoose.connect(config.db.testUri); // the same database the app uses (src/server.js)
console.log(`database: ${mongoose.connection.name}${apply ? '' : '  [dry run]'}`);

const tours = (await Tour.find().select('order title startDate duration')).filter((t) =>
  tourHasEnded(t),
);
let total = 0;
for (const tour of tours.sort((a, b) => a.order - b.order)) {
  const reservations = await Reservation.find({ tour: tour._id }).select('attendees.paid');
  const unpaid = reservations.reduce(
    (n, r) => n + r.attendees.filter((a) => a.paid !== true).length,
    0,
  );
  if (!unpaid) continue;
  total += unpaid;
  console.log(`${String(tour.order).padStart(3)}. ${tour.title}: ${unpaid} unpaid`);
  if (apply) {
    await Reservation.updateMany({ tour: tour._id }, { $set: { 'attendees.$[].paid': true } });
  }
}
console.log(
  `${tours.length} ended tours; ${total} attendee(s) ${apply ? 'marked paid' : 'would be marked paid'}.`,
);
await mongoose.disconnect();
