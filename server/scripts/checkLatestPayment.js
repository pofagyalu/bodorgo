import 'dotenv/config';
import mongoose from 'mongoose';
import Payment from '../src/models/paymentModel.js';

await mongoose.connect(process.env.DB_URI);
const p = await Payment.findOne().sort('-createdAt').lean();
console.log(JSON.stringify(p, null, 2));
await mongoose.disconnect();
process.exit(0);
