import fs from 'fs';
import os from 'os';
import path from 'path';
import Transport from 'winston-transport';
import config from '../config.js';
import logger from '../logger.js';
import User from '../models/userModel.js';
import sendResendEmail from './resendEmail.js';
import { escapeHtml } from './mailHtml.js';

// The server's errors by e-mail to the role manager - so a problem is known
// without being home to read the log. Live only (startErrorMail is called by
// server.js when NODE_ENV is production).
//
// - Only real errors: a 4xx answer (mostly bots trying /.env, /wp-admin...)
//   is logged as an error too, but never mailed.
// - At most one e-mail per MAIL_EVERY_MS: the errors in between wait and go
//   together in the next one. The time of the last e-mail and the waiting
//   errors are kept in a file next to the logs, so a crash loop (pm2
//   starting the server again and again) can't send one e-mail per start.
// - A crash: server.js's uncaughtException handler waits a few seconds for
//   flushErrorMailNow before the process exits.

export const MAIL_EVERY_MS = 15 * 60 * 1000;
// A first error waits this long, so a burst arrives in one e-mail.
const FIRST_WAIT_MS = 60 * 1000;
const KEEP_ERRORS = 30; // listed in one e-mail; the rest only counted
const MAX_LENGTH = 2000; // of one error's text (a stack trace is long)

// Next to the logs (gitignored); the tests' own in the temp folder.
const STATE_FILE =
  config.nodeEnv === 'test'
    ? path.join(os.tmpdir(), `bodorgo-error-mail-${process.pid}.json`)
    : path.resolve('logs', '.error-mail.json');

const isClientError = (message) => /^4\d\d - /.test(message);

let state = { lastSent: 0, pending: [], dropped: 0 };
let timer = null;
let sending = null;
let started = false;

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state = {
      lastSent: Number(saved.lastSent) || 0,
      pending: Array.isArray(saved.pending) ? saved.pending : [],
      dropped: Number(saved.dropped) || 0,
    };
  } catch {
    // No file yet (or a broken one): start empty.
  }
}

function writeState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.error(`Error mail state could not be saved: ${err.message}`);
  }
}

// The error's text: the message, and the stack when winston was given an
// Error (logger.error('...', err)).
function textOf(info) {
  const message = String(info.message ?? '');
  const stack = typeof info.stack === 'string' ? info.stack : '';
  const text = stack && !message.includes(stack) ? `${message}\n${stack}` : message;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

export function noteError(info) {
  const message = String(info.message ?? '');
  if (isClientError(message)) return;
  if (state.pending.length < KEEP_ERRORS) {
    state.pending.push({ at: info.timestamp ?? new Date().toISOString(), text: textOf(info) });
  } else {
    state.dropped += 1;
  }
  writeState();
  schedule();
}

function schedule() {
  if (timer || !state.pending.length) return;
  const wait = Math.max(FIRST_WAIT_MS, state.lastSent + MAIL_EVERY_MS - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void send();
  }, wait);
  timer.unref?.();
}

async function recipients() {
  const managers = await User.find({ canManageRoles: true, email: { $nin: [null, ''] } })
    .select('email')
    .lean();
  const emails = managers.map((u) => u.email);
  if (!emails.length && config.initialAdminUser) emails.push(config.initialAdminUser);
  return emails;
}

function logsPageUrl() {
  return `${(config.clientBaseUrl || '').replace(/\/$/, '')}/klub/naplo?lap=fajlok`;
}

function send() {
  if (sending) return sending;
  sending = (async () => {
    if (!state.pending.length) return;
    const errors = state.pending;
    const total = errors.length + state.dropped;
    const to = await recipients();
    if (!to.length) return;
    const url = logsPageUrl();
    const more = state.dropped ? `\n… és még ${state.dropped} hiba.` : '';
    await sendResendEmail({
      to,
      subject: `Bódorgó szerver: ${total} hiba`,
      html: [
        `<p>A szerver ${total} hibát naplózott. Részletek: <a href="${escapeHtml(url)}">Klub → Napló → Naplófájlok</a></p>`,
        ...errors.map(
          (e) =>
            `<p style="margin:12px 0 4px;color:#56666e">${escapeHtml(e.at)}</p><pre style="margin:0;white-space:pre-wrap;font-size:12px">${escapeHtml(e.text)}</pre>`,
        ),
        state.dropped ? `<p>… és még ${state.dropped} hiba.</p>` : '',
      ].join(''),
      text:
        [
          `A szerver ${total} hibát naplózott. Részletek: ${url}`,
          ...errors.map((e) => `\n${e.at}\n${e.text}`),
        ].join('\n') + more,
    });
    state = { lastSent: Date.now(), pending: [], dropped: 0 };
    writeState();
  })()
    .catch((err) => {
      // Not logger.error: that would be mailed again. Tried again later.
      logger.warn(`Error mail could not be sent: ${err.message}`);
      state.lastSent = Date.now();
      writeState();
      schedule();
    })
    .finally(() => {
      sending = null;
    });
  return sending;
}

// Before the process exits on a crash: the waiting errors now, unless an
// e-mail went out less than MAIL_EVERY_MS ago (then the next start sends
// them). Gives up after timeoutMs.
export async function flushErrorMailNow(timeoutMs = 5000) {
  if (!started || !state.pending.length) return;
  if (Date.now() - state.lastSent < MAIL_EVERY_MS) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await Promise.race([send(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

class ErrorMailTransport extends Transport {
  log(info, callback) {
    try {
      noteError(info);
    } catch (err) {
      console.error(`Error mail failed: ${err.message}`);
    }
    callback();
  }
}

export function startErrorMail() {
  if (started) return;
  started = true;
  readState();
  logger.add(new ErrorMailTransport({ level: 'error', handleExceptions: true }));
  schedule(); // errors left from before a restart
}

// For the tests: back to an empty start.
export function resetErrorMailForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  sending = null;
  started = false;
  state = { lastSent: 0, pending: [], dropped: 0 };
  fs.rmSync(STATE_FILE, { force: true });
}

export const sendErrorMailForTests = () => send();
export const errorMailStateForTests = () => state;
