import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

const DB_URI = `mongodb+srv://${config.db.userName}:${config.db.password}@${config.db.clusterAddress}/?retryWrites=true&w=majority`;

async function main() {
  await mongoose.connect(DB_URI);
  logger.info('Successfully connected to MongoDB');
}

main().catch((err) => logger.error(err));
