import { format, createLogger, transports } from 'winston';

const { combine, timestamp, printf, colorize } = format;

const options = {
  file: {
    level: 'info',
    handleExceptions: true,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    colorize: false,
    format: combine(
      timestamp({ format: 'YYYY.MM.DD hh:mm:ss' }),
      format.json(),
    ),
  },
  console: {
    level: 'debug',
    handleExceptions: true,
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY.MM.DD hh:mm:ss' }),
      printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`),
    ),
  },
};

const logger = createLogger({
  exitOnError: false,
  handleRejections: true,
  transports: [
    new transports.File({
      ...options.file,
      filename: 'logs/combined.log',
    }),
    new transports.File({
      ...options.file,
      level: 'error',
      filename: 'logs/error.log',
    }),
  ],
});

logger.stream = {
  write: (message) => {
    logger.info(message);
  },
};

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console(options.console));
}

export default logger;
