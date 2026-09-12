import session from 'express-session';
import MongoStore from 'connect-mongo';
import config from './config.js';

// Built once with the real mongoose-backed MongoClient and shared between
// Express (app.js) and Socket.IO (server.js) so both see the same session
// store and secret - this is what lets a socket connection read
// `socket.request.session.user`, the same shape requireAuth.js reads.
const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60; // 90 days

export default function createSessionMiddleware(mongoClient) {
  return session({
    secret: config.cookie.secret,
    resave: false,
    saveUninitialized: false,
    // Without this, express-session's default cookie has no maxAge (a
    // browser-session cookie), so it's discarded on browser close no matter
    // how long the Mongo store keeps the session around. rolling:true
    // refreshes the expiry on every request, so an active user effectively
    // never gets logged out while an inactive one still expires eventually.
    rolling: true,
    cookie: {
      maxAge: SESSION_MAX_AGE_SECONDS * 1000,
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
    },
    store: MongoStore.create({
      client: mongoClient,
      dbName: 'bodorgo-test',
      collectionName: 'sessions',
      ttl: SESSION_MAX_AGE_SECONDS,
      touchAfter: 24 * 3600,
    }),
  });
}
