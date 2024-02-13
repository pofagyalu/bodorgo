import express from 'express';
import morgan from 'morgan';
import config from './config.js';
import logger from './logger.js';

import tourRouter from './routes/tour.routes.js';
import userRouter from './routes/user.routes.js';
import swaggerRouter from './routes/swagger.routes.js';

const app = express();

if (config.nodeEnv === 'development') {
  app.use(morgan('combined', { stream: logger.stream }));
}
app.use(express.json());

app.use('/v1/tours', tourRouter);
app.use('/v1/users', userRouter);
app.use('/api-docs', swaggerRouter);

//
export default app;
