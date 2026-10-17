// What Móka → Kvíz → Pontozás has stored (nothing: never set yet).
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';

const uri = config.db.uri;
await mongoose.connect(uri);
console.log(
  mongoose.connection.name,
  await mongoose.connection.db.collection('quizscorings').find().toArray(),
);
await mongoose.disconnect();
