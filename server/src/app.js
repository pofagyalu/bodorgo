import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';

import logger from './logger';
import errorHandler from './middlewares/error-handler';
import AppError from './utils/app-error';
import config from './config';

import tourRouter from './routes/tour.routes';
import userRouter from './routes/user.routes';
import reviewRouter from './routes/review.routes';
import bookingRouter from './routes/booking.routes';
import swaggerRouter from './routes/swagger.routes';

const app = express();
app.options('*', cors());

app.use(cors());

app.use(cookieParser(config.jwt.secret));

app.use(helmet());

app.use(morgan('combined', { stream: logger.stream }));

const limiter = rateLimit({
  max: 120,
  windowMs: 60 * 60 * 1000,
  message: 'Too may requests from this IP, please try again in an hour!',
});
app.use('/', limiter);

app.use(express.json({ limit: '10kb' }));

app.use(mongoSanitize());

app.use(
  hpp({
    whitelist: ['duration'],
  }),
);

app.use('/api/v1/tours', tourRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/bookingss', bookingRouter);
app.use('/api/api-docs', swaggerRouter);

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(errorHandler);

export default app;
