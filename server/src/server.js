import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import config from './config.js';
import createApp from './app.js';
import createSessionMiddleware from './session.js';
import registerChatHandlers from './chat/chatSocket.js';
import logger from './logger.js';
import { checkPollReminders } from './chat/pollReminders.js';
import { ensureDocumentPreviews } from './utils/documentPreviews.js';
import {
  checkMembershipReminders,
  notifyAdminsIfAllMembersPaid,
} from './utils/membershipReminders.js';

// This handler must run before anything else
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💣 Shutting down...', err);
  process.exit(1);
});

const DB = config.db.uri;
const PORT = config.port;

mongoose
  .connect(DB)
  .then(() => {
    logger.info('Adatbázis kapcsolat sikeres!');
    // IMPORTANT: now we have a valid connected client
    const mongoClient = mongoose.connection.getClient();

    // Built once and shared between Express and Socket.IO - see session.js.
    const sessionMiddleware = createSessionMiddleware(mongoClient, mongoose.connection.name);

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

    // Dokumentumok: a preview for any document still without one (see
    // utils/documentPreviews.js) - in the background, every server
    // (each makes its own).
    ensureDocumentPreviews().catch((err) =>
      logger.error(`Document previews failed: ${err.message}`),
    );

    // New tour recap videos are announced by an admin's "Új média
    // felfedezése" (see photos/discovery.js), not on a schedule - the NAS
    // is only read when someone has actually added something.

    // Every 10 minutes: remind people about polls closing within 2 hours
    // they haven't voted in (see chat/pollReminders.js). Live server only
    // (BACKGROUND_JOBS=on) - the reminders must go out once.
    if (config.backgroundJobs) {
      setInterval(
        () =>
          checkPollReminders().catch((err) =>
            logger.error(`Poll reminders failed: ${err.message}`),
          ),
        10 * 60 * 1000,
      );

      // Every hour (see utils/membershipReminders.js): the "Tagdíj
      // emlékeztető" round due today, if any - each round once, from 9 a.m.
      // Budapest time - and whether the year's dues are now all in (the
      // admins' e-mail, once a year). A cash payment recorded by an admin is
      // only picked up here, so a misclick undone within the hour sends
      // nothing. Only reads the database and sends e-mails.
      setInterval(
        () => {
          checkMembershipReminders().catch((err) =>
            logger.error(`Membership reminders failed: ${err.message}`),
          );
          notifyAdminsIfAllMembersPaid().catch((err) =>
            logger.error(`All-paid check failed: ${err.message}`),
          );
        },
        60 * 60 * 1000,
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
