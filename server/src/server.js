import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import config from './config.js';
import createApp from './app.js';
import createSessionMiddleware from './session.js';
import registerChatHandlers from './chat/chatSocket.js';
import logger from './logger.js';
import { checkForNewTourVideos } from './controllers/tourVideoController.js';
import { checkPollReminders } from './chat/pollReminders.js';

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

    // Built once and shared between Express and Socket.IO - see session.js.
    const sessionMiddleware = createSessionMiddleware(mongoClient);

    const app = createApp(sessionMiddleware);
    const server = http.createServer(app);

    const io = new Server(server, {
      cors: { origin: config.corsOrigins, credentials: true },
    });
    // Runs the same session middleware Express uses, once per handshake, so
    // socket.request.session is populated just like req.session is.
    io.engine.use(sessionMiddleware);
    registerChatHandlers(io);

    server.listen(PORT, () => {
      logger.info(`App is listening on ${PORT} (Node ${process.version})`);
    });

    // Every 12 hours (and a few minutes after each start): e-mail the
    // attendees of tours whose recap video has just appeared on the NAS.
    // Only where TOUR_VIDEO_EMAILS=on (the live server's .env) - a local
    // dev server shares the same database and must not send them too.
    if (config.tourVideoEmails) {
      const checkVideos = () =>
        checkForNewTourVideos().catch((err) => logger.error(`Tour video check failed: ${err.message}`));
      setTimeout(checkVideos, 5 * 60 * 1000);
      setInterval(checkVideos, 12 * 60 * 60 * 1000);
    }

    // Every 10 minutes: remind people about polls closing within 2 hours
    // they haven't voted in (see chat/pollReminders.js). Live server only
    // (BACKGROUND_JOBS=on) - the reminders must go out once.
    if (config.backgroundJobs) {
      setInterval(
        () => checkPollReminders().catch((err) => logger.error(`Poll reminders failed: ${err.message}`)),
        10 * 60 * 1000,
      );
    }

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
