import express from 'express';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';

import logger from './logger.js';
import errorHandler from './middlewares/error-handler.js';
import AppError from './utils/app-error.js';

import tourRouter from './routes/tour.routes.js';
import userRouter from './routes/user.routes.js';
import swaggerRouter from './routes/swagger.routes.js';

const app = express();

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

app.use(xss());

app.use('/v1/tours', tourRouter);
app.use('/v1/users', userRouter);
app.use('/api-docs', swaggerRouter);

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(errorHandler);

export default app;
