import 'dotenv/config';
import config from './config';
import logger from './logger';
import './db';
import app from './app';

process.on('uncaughtException', (err) => {
  logger.error(`UNCAUGHT EXCEPTION! ${err.message} 🧨 Shutting down...`);

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
