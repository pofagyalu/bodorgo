import 'dotenv/config';
import mongoose from 'mongoose';
import Payment from '../src/models/paymentModel.js';
import User from '../src/models/userModel.js';
import { getPaymentStatus } from '../src/controllers/paymentController.js';

await mongoose.connect(process.env.DB_URI);

const payment = await Payment.findOne().sort('-createdAt');
const user = await User.findById(payment.createdBy);

const req = { params: { id: String(payment._id) }, user };
const res = {
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    console.log('Response:', JSON.stringify(body, null, 2));
  },
};

await getPaymentStatus(req, res);

await mongoose.disconnect();
process.exit(0);
