import config from '../config';
import logger from '../logger';
import AppError from '../utils/app-error';

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const dupField = Object.keys(err.keyValue)[0]; // match(/(["'])(\\?.)*?\1/);
  const message = `Duplicate field "${dupField}". Please use another value(${err.keyValue[dupField]})!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data: ${errors.join('. ')}`;
  return new AppError(message, 400);
};

const handleJWTError = () => new AppError('Invalid token. Please login!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired. Please login again!', 401);

const sendErrorDev = (err, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      error: err,
      stack: err.stack,
    });
  } else {
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!',
    });
  }
};

const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong!',
    });
  }
};

export default (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  let error = Object.assign(err);

  if (error.name === 'CastError') error = handleCastErrorDB(error);
  if (error.code === 11000) error = handleDuplicateFieldsDB(error);
  if (error.name === 'ValidationError') {
    error = handleValidationErrorDB(error);
  }

  if (error.name === 'JsonWebTokenError') error = handleJWTError();
  if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();

  logger.error(
    `${error.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`,
  );

  if (config.nodeEnv === 'development') {
    sendErrorDev(error, res);
  } else if (config.nodeEnv === 'production' || config.nodeEnv === 'test') {
    sendErrorProd(error, res);
  }
};
