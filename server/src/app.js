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
      allowedHeaders: ['Content-Type', 'Authorization'],
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

  // Body parser, reading data from body into
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true }));

  // TODO: old solution try to dins some replacement
  // app.use(mongoSanitize());

  // Registered before the public static middleware below (which serves
  // everything under public/ with zero auth) so a same-named path could
  // never accidentally fall through to an unauthenticated public file -
  // documentRoutes.js's files live outside public/ entirely anyway, but
  // this keeps the auth check first no matter what.
  app.use('/documents', documentRouter);

  app.use(express.static(path.join(rootDir, 'public')));

  app.use((req, res, next) => {
    req.requestTime = new Date().toISOString();
    next();
  });

  app.use(compression());

  app.use('/auth', authOidcRouter);
  app.use('/tours', tourRouter);
  app.use('/users', userRouter);
  app.use('/health', systemRouter);

  app.use((req, res, next) => {
    // Since next gets an argument Express assumes this is an error
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
  });

  app.use(globalErrorHandler);

  return app;
}
