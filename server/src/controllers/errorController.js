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
    ...(typeof err.code === 'string' ? { code: err.code } : {}),
    stack: err.stack,
  });
};

// Where an unexpected error broke, short: our own code's first three places
// ("tourCourseWindow (futokor/tourWindow.js:54)"), never Node's or a
// library's - the whole stack is a screenful nobody reads.
export const whereItBroke = (err) =>
  String(err?.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /[\\/]src[\\/]/.test(line) && !/node_modules/.test(line))
    .slice(0, 3)
    .map((line) =>
      line
        .slice(3)
        .replace(/\S*[\\/]src[\\/]/, '(')
        .replace(/:\d+\)?$/, ')'),
    )
    .join(' ← ');

// Production: an expected (operational) error's own message goes to the
// user; anything else only a generic one - never a stack trace. The log
// gets where it broke and the names of the fields sent - not their
// values, which may be phone numbers and the like.
const sendErrorProd = (err, req, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      ...(typeof err.code === 'string' ? { code: err.code } : {}),
    });
  } else {
    const where = whereItBroke(err);
    const fields = Object.keys(req.body ?? {});
    logger.error(
      `ERROR 💣 ${err.name ?? 'Error'}: ${err.message}` +
        (where ? ` - at ${where}` : '') +
        (fields.length ? ` - fields sent: ${fields.join(', ')}` : ''),
    );
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
    sendErrorProd(error, req, res);
  }
};
