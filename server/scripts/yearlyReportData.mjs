// A look at what the yearly club report has to work with (read-only):
//   node scripts/yearlyReportData.mjs [year]
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';
import Tour from '../src/models/tourModel.js';
import Transaction from '../src/models/transactionModel.js';
import Reservation from '../src/models/reservationModel.js';

const year = Number(process.argv[2] ?? new Date().getFullYear());
await mongoose.connect(config.db.uri);
console.log('db:', mongoose.connection.name);

const roles = await User.aggregate([
  { $group: { _id: { role: '$role', retired: '$retired' }, n: { $sum: 1 } } },
]);
console.log('users by role/retired:', JSON.stringify(roles));
console.log(
  'memberSince:',
  JSON.stringify(await User.aggregate([{ $group: { _id: '$memberSince', n: { $sum: 1 } } }])),
);

const tx = await Transaction.find().sort('date').lean();
console.log('transactions:', tx.length);
for (const t of tx.filter((x) => x.date.getUTCFullYear() >= year - 1)) {
  console.log(
    t.date.toISOString().slice(0, 10),
    t.type,
    t.category,
    t.amount,
    t.currency,
    t.membershipYear ?? '',
    t.paymentMethod ?? '',
    t.user ? 'user' : '',
    '|',
    t.user ? '' : t.name,
  );
}

const tours = await Tour.find({
  startDate: { $gte: new Date(`${year}-01-01`), $lt: new Date(`${year + 1}-01-01`) },
})
  .select(
    'order title location startDate duration distanceFromBudapestKm clubSubsidyAmount closed secretTour',
  )
  .sort('startDate')
  .lean();
for (const t of tours) {
  const res = await Reservation.find({ tour: t._id }).lean();
  const people = new Set(res.flatMap((r) => r.attendees.map((a) => String(a.user))));
  console.log(
    t.order,
    t.title,
    t.startDate.toISOString().slice(0, 10),
    `${t.duration} nap`,
    `${t.distanceFromBudapestKm} km`,
    `${people.size} fő`,
    JSON.stringify(t.location)?.slice(0, 120),
    'subsidy',
    t.clubSubsidyAmount,
    t.closed ? 'closed' : '',
    t.secretTour ? JSON.stringify(t.secretTour) : '',
  );
}
for (const name of mongoose.connection.modelNames()) void name;
const counts = {};
for (const c of await mongoose.connection.db.listCollections().toArray()) {
  counts[c.name] = await mongoose.connection.db.collection(c.name).estimatedDocumentCount();
}
console.log(counts);
await mongoose.disconnect();
