import AppError from '../utils/appError.js';
import config from '../config.js';
import logger from '../logger.js';

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue);
  const value = err.keyValue[field];
  const message = `Duplicate field value: "${field}": ${value}. Please use another value.`;
  return new AppError(message, 400);
};

const handleValidationErrorsDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

const handleJWTError = () => new AppError('Invalid token. Please login again', 401);

const handleJWTExpiredError = () => new AppError('Your token has expired. Please login again', 401);

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

// Production: an expected (operational) error's own message goes to the
// user; anything else only a generic one - never a stack trace.
const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    logger.error('ERROR 💣', err);
    res.status(500).json({
      status: 'error',
      message: 'Váratlan hiba történt. Kérjük, próbáld újra később.',
    });
  }
};

export default (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  logger.error(
    `${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`,
  );

  // Anything but production (development, test, or NODE_ENV unset) gets the
  // detailed response - previously only an exact 'development' did, and any
  // other value left every failing request hanging with no response at all.
  if (config.nodeEnv !== 'production') {
    sendErrorDev(err, res);
  } else {
    // The error itself, not a { ...err } copy - an Error's message isn't
    // copied by a spread, which blanked every message in production.
    let error = err;
    if (err.name === 'CastError') error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicateFieldsDB(err);
    if (err.name === 'ValidationError') error = handleValidationErrorsDB(err);
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
    sendErrorProd(error, res);
  }
};
