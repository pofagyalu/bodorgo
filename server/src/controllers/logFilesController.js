import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import AppError from '../utils/appError.js';

const gunzip = promisify(zlib.gunzip);

// Klub → Napló → Naplófájlok: the server's own log files (logger.js - one
// app and one error file a day, kept 14 and 30 days, older days gzipped) -
// the role manager's alone, after re-identifying (settingsRoutes.js).

const LOG_DIR = path.resolve('logs');
// app-2026-10-14.log, error-2026-10-13.log.gz, app-2026-10-14.log.1 (a day
// over 20 MB goes on in a numbered file).
const LOG_NAME = /^(app|error)-(\d{4}-\d{2}-\d{2})\.log(\.\d+)?(\.gz)?$/;
const DEFAULT_LINES = 500;
const MAX_LINES = 5000;

// A name from the request: only one of the log files, never a path.
async function logFile(name) {
  const match = LOG_NAME.exec(String(name ?? ''));
  if (!match) throw new AppError('Nincs ilyen naplófájl.', 404);
  const file = path.join(LOG_DIR, match[0]);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    return { file, kind: match[1], date: match[2], gz: !!match[4], size: stat.size };
  } catch {
    throw new AppError('Nincs ilyen naplófájl.', 404);
  }
}

// GET /settings/logs - every log file, newest day first (app before error
// on the same day).
export const listLogFiles = async (req, res) => {
  let names = [];
  try {
    names = await fs.readdir(LOG_DIR);
  } catch {
    // No logs folder yet: no files.
  }
  const files = [];
  for (const name of names.filter((n) => LOG_NAME.test(n))) {
    const { kind, date, gz, size } = await logFile(name);
    files.push({ name, kind, date, gz, size });
  }
  files.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  res.status(200).json({ status: 'success', data: { files } });
};

// GET /settings/logs/:name?lines=500 - the file's last lines (a gzipped
// day unpacked), oldest first, and how many lines it has in all.
export const getLogFile = async (req, res) => {
  const { file, gz } = await logFile(req.params.name);
  const wanted = Math.min(MAX_LINES, Math.max(1, Number(req.query.lines) || DEFAULT_LINES));
  const raw = await fs.readFile(file);
  const text = (gz ? await gunzip(raw) : raw).toString('utf8');
  const all = text.split(/\r?\n/);
  if (all.at(-1) === '') all.pop();
  res.status(200).json({
    status: 'success',
    data: { name: req.params.name, totalLines: all.length, lines: all.slice(-wanted) },
  });
};

// GET /settings/logs/:name/download - the file as it is on the disk.
export const downloadLogFile = async (req, res) => {
  const { file } = await logFile(req.params.name);
  res.download(file, path.basename(file));
};
