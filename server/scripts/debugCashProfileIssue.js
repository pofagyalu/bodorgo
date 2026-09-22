import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/userModel.js';
import Reservation from '../src/models/reservationModel.js';
import Payment from '../src/models/paymentModel.js';
import Tour from '../src/models/tourModel.js';

await mongoose.connect(process.env.DB_URI);

const me = await User.findOne({ email: 'pofagyalu@gmail.com' });
console.log('User:', me?._id, me?.name, me?.email);

const reservations = await Reservation.find({ 'attendees.user': me._id }).populate('tour', 'title order');
for (const r of reservations) {
  const mine = r.attendees.find((a) => String(a.user) === String(me._id));
  console.log('---');
  console.log('Tour:', r.tour?.order, r.tour?.title);
  console.log('attendeeId:', mine?._id.toString(), 'paid:', mine?.paid);
  const payment = await Payment.findOne({ purpose: 'tourAdvance', status: 'Succeeded', 'attendees.attendeeId': mine?._id });
  console.log('matching Payment:', payment ? { id: payment._id.toString(), method: payment.method, createdBy: payment.createdBy.toString() } : null);
}

await mongoose.disconnect();
process.exit(0);
