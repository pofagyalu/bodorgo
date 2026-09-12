import 'dotenv/config';
import mongoose from 'mongoose';
import config from './config.js';
import createApp from './app.js';
import logger from './logger.js';

// This handler must run before anything else
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💣 Shutting down...', err);
  process.exit(1);
});

const DB = config.db.testUri;
const PORT = config.port;

mongoose
  .connect(DB)
  .then(() => {
    logger.info('Adatbázis kapcsolat sikeres!');
    // IMPORTANT: now we have a valid connected client
    const mongoClient = mongoose.connection.getClient();

    const app = createApp(mongoClient);
    const server = app.listen(PORT, () => {
      logger.info(`App is listening on ${PORT}`);
    });

    process.on('SIGINT', (err) => {
      logger.info('PM2 SHUTDOWN! 💣 Shutting down...', err);
      server.close((error) => process.exit(error ? 1 : 0));
    });

    // Restart must be performed by 3rd party tool like pm2
    process.on('unhandledRejection', (err) => {
      logger.error('UNHANDLED REJECTION! 💣 Shutting down...', err);
      // Graceful shutdown waiting for server to close
      server.close(() => {
        process.exit(1);
      });
    });
  })
  .catch((err) => logger.error(err));
