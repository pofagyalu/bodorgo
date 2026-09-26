import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import path from 'path';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// import * as client from 'openid-client';
import config from './config.js';
// import mongoSanitize from 'express-mongo-sanitize';

import tourRouter from './routes/tourRoutes.js';
import userRouter from './routes/userRoutes.js';
import systemRouter from './routes/systemRoutes.js';
import authOidcRouter from './routes/authOidcRoutes.js';
import documentRouter from './routes/documentRoutes.js';
import requireAuth from './auth/requireAuth.js';
import { TOUR_DOCUMENTS_DIR } from './utils/dataDirs.js';
import paymentRouter from './routes/paymentRoutes.js';
import financeRouter from './routes/financeRoutes.js';
import membershipRouter from './routes/membershipRoutes.js';
import pollRouter from './routes/pollRoutes.js';
import { stripeWebhook } from './controllers/paymentController.js';
import AppError from './utils/appError.js';
import globalErrorHandler from './controllers/errorController.js';
import logger from './logger.js';

const rootDir = path.resolve();

// sessionMiddleware is built once in server.js and shared with Socket.IO -
// see session.js for why.
export default function createApp(sessionMiddleware) {
  const app = express();

  app.set('trust proxy', 1);

  // Set security HTTP headers

  app.use(cookieParser(config.cookie.secret));

  app.use(sessionMiddleware);

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true, // if sending cookies/tokens
      // PUT added for reviewController.js's submitReview - without it, the
      // browser's own CORS preflight (client and API are on different
      // subdomains) silently blocks the request before it ever reaches the
      // server, surfacing client-side as a generic network error rather
      // than any response this app's own error handling could shape.
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // Range lets the browser send byte-range requests for the tour
      // recap <video> (see tourVideoController.js) - without it here, a
      // cross-origin preflight (client/API are different subdomains)
      // blocks seeking/scrubbing outright. The exposed headers are what
      // the video element actually reads back to know a range request
      // succeeded - none of the three are in a CORS response's default
      // safelist.
      allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
      exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
    }),
  );

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(morgan('combined', { stream: logger.stream }));

  const limiter = rateLimit({
    windowMs: 15 * 60000, // 15 minutes
    max: 1000,
    handler: function (req, res, next) {
      logger.warn(`Rate limit exceeded: ${req.ip}`);

      return res.status(429).json({
        message: 'Too many requests from this IP, please try again in an hour',
      });
    },
  });
  app.use(limiter);

  // Stripe's webhook signature check needs the exact raw request bytes,
  // not the parsed object express.json() below would otherwise produce -
  // this has to be registered before that global body parser, or by the
  // time the request reaches paymentController.js's stripeWebhook the
  // raw body is already gone. No requireAuth either - Stripe calls this
  // server-to-server, verified by signature instead (see
  // utils/stripe.js's constructWebhookEvent).
  app.post('/payments/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

  // Body parser, reading data from body into
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true }));

  // TODO: old solution try to dins some replacement
  // app.use(mongoSanitize());

  // Members-only app: nothing under public/ is served to everyone any
  // more (tour covers moved into the database - see tourCoverModel.js).
  // The one thing still read from there is each tour's "Extra infók"
  // uploads (see tourDocumentController.js), and only for a logged-in
  // user. Registered before the club documents router below, whose own
  // '/:filename' route would otherwise never match these deeper paths
  // anyway.
  app.use(
    '/documents/tours',
    requireAuth,
    express.static(TOUR_DOCUMENTS_DIR),
  );
  app.use('/documents', documentRouter);

  app.use((req, res, next) => {
    req.requestTime = new Date().toISOString();
    next();
  });

  app.use(compression());

  app.use('/auth', authOidcRouter);
  app.use('/tours', tourRouter);
  app.use('/users', userRouter);
  app.use('/payments', paymentRouter);
  app.use('/finance', financeRouter);
  app.use('/membership', membershipRouter);
  app.use('/polls', pollRouter);
  app.use('/health', systemRouter);

  app.use((req, res, next) => {
    // Since next gets an argument Express assumes this is an error
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
  });

  app.use(globalErrorHandler);

  return app;
}
