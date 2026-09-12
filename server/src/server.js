import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import config from './config.js';
import createApp from './app.js';
import createSessionMiddleware from './session.js';
import registerChatHandlers from './chat/chatSocket.js';
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
