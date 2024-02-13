import 'dotenv/config';
import config from './config.js';
import logger from './logger.js';
import './db.js';
import app from './app.js';

const PORT = config.port;

app.listen(PORT, () => {
  logger.info(`App running on port ${PORT}...`);
});
