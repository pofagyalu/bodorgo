import 'dotenv/config';
import config from './config.js';
import logger from './logger.js';
import './db.js';
import app from './app.js';

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 🧨 Shutting down...', err.message);

  process.exit(1);
});

const PORT = config.port;
const server = app.listen(PORT, () => {
  logger.info(`Bódorgó App running on port ${PORT}...`);
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! 🧨 Shutting down...', err.message);
  server.close(() => {
    process.exit(1);
  });
});
