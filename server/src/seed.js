import mongoose from 'mongoose';
import config from './config';
import Tour from './tour/tour.model';

import { tours } from './tour/tours.json';

const DB_URI = `mongodb+srv://${config.db.userName}:${config.db.password}@${config.db.clusterAddress}/bodorgo?retryWrites=true&w=majority`;

async function seed() {
  const connection = await mongoose.connect(DB_URI);

  if (connection) {
    await Tour.deleteMany();
    await Tour.insertMany(tours);

    mongoose.connection.close();
  }
}

seed();
