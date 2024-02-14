import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

const DB_URI = `mongodb+srv://${config.db.userName}:${config.db.password}@${config.db.clusterAddress}/bodorgo?retryWrites=true&w=majority`;

async function main() {
  await mongoose.connect(DB_URI);
  logger.info('MongoDB connection succesful!');
}

main().catch((err) => logger.error(err));
