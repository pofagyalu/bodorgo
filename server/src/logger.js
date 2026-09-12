import { format, createLogger, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const { combine, timestamp, printf, colorize } = format;

const consoleOptions = {
  level: 'debug',
  handleExceptions: true,
  format: combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`),
  ),
};

const logFormat = printf(
  (info) => `[${info.timestamp}] ${info.level}: ${info.message}`,
);

const logger = createLogger({
  exitOnError: false,
  handleRejections: true,
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
  transports: [
    // 🔥 Rotated application logs
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true, // gzip compression
      maxSize: '20m', // max size before rotating
      maxFiles: '14d', // keep 14 days
      level: 'info',
      handleExceptions: true,
      // handleRejections: true,
    }),

    // 🔥 Rotated error logs
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
      handleExceptions: true,
    }),
  ],
});

logger.stream = {
  write: (message) => logger.info(message.trim()),
};

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console(consoleOptions));
}

export default logger;
