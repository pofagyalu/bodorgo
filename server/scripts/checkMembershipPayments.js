import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Payment from '../src/models/paymentModel.js';

await mongoose.connect(config.db.testUri);
const payments = await Payment.find({ purpose: 'membershipFee' })
  .sort('-createdAt')
  .limit(5)
  .lean();
console.log(JSON.stringify(payments, null, 2));
await mongoose.disconnect();
