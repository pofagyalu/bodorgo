import session from 'express-session';
import MongoStore from 'connect-mongo';
import config from './config.js';

// Built once with the real mongoose-backed MongoClient and shared between
// Express (app.js) and Socket.IO (server.js) so both see the same session
// store and secret - this is what lets a socket connection read
// `socket.request.session.user`, the same shape requireAuth.js reads.
export default function createSessionMiddleware(mongoClient) {
  return session({
    secret: config.cookie.secret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client: mongoClient,
      dbName: 'bodorgo-test',
      collectionName: 'sessions',
      ttl: 14 * 24 * 60 * 60,
      touchAfter: 24 * 3600,
    }),
  });
}
