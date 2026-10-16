import mongoose from 'mongoose';
import { deviceName } from './deviceName.js';
import { isInternalAddress } from './internalAddress.js';
import { SESSION_MAX_AGE_SECONDS } from '../session.js';

// A person's sessions in the app itself (the `sessions` collection of
// session.js): every browser logged in to Bódorgó, whether or not Authentik
// still remembers it. The store writes a session back at most once a day
// (touchAfter), so "last active" is its expiry minus the 90 days - true to
// within a day. The device was only saved from 2026-10-15 on (at login).
// Logins from localhost or the Docker network are left out (but this
// browser's own always shows) - see internalAddress.js.

const collection = () => mongoose.connection.db.collection('sessions');

const parse = (doc) => (typeof doc.session === 'string' ? JSON.parse(doc.session) : doc.session);

async function sessionsOf(userId) {
  const docs = await collection()
    .find({ session: { $regex: `"id":"${String(userId)}"` } })
    .toArray();
  return docs
    .map((doc) => ({ doc, data: parse(doc) }))
    .filter(({ data }) => data?.user?.id === String(userId));
}

// At a login: the same browser's older sessions (same User-Agent, brand
// list and address) go - a browser that lost its cookie (cleared, a private
// window) leaves its old session behind, still valid for 90 days. The brand
// list keeps Brave and Chrome apart (same User-Agent); two profiles of one
// browser on one computer can't be told apart: logging in on one logs the
// other out.
export async function replaceSameDeviceSessions(
  userId,
  { userAgent, brands = '', ip },
  currentSessionId,
) {
  if (!userAgent) return;
  const old = (await sessionsOf(userId)).filter(
    ({ doc, data }) =>
      doc._id !== currentSessionId &&
      data.user.userAgent === userAgent &&
      (data.user.brands ?? '') === brands &&
      data.user.ip === ip,
  );
  if (old.length) await collection().deleteMany({ _id: { $in: old.map(({ doc }) => doc._id) } });
}

// Logging out: every session of theirs goes, but `except` (the browser
// asking, when it is themselves) - also the ones the list leaves out.
// Returns how many went.
export async function endAppSessions(userId, { except } = {}) {
  const ids = (await sessionsOf(userId)).map(({ doc }) => doc._id).filter((id) => id !== except);
  if (ids.length) await collection().deleteMany({ _id: { $in: ids } });
  return ids.length;
}

// Newest first: { id, current, device, ip, loginAt, lastActiveAt, expiresAt }.
// `id` is not the session's own id (that is the cookie's value), only a
// stand-in for telling the rows apart.
export async function listAppSessions(userId, currentSessionId) {
  return (await sessionsOf(userId))
    .map(({ doc, data }, i) => {
      const expiresAt = doc.expires ? new Date(doc.expires) : null;
      return {
        id: `s${i + 1}`,
        current: doc._id === currentSessionId,
        device: deviceName(data.user.userAgent, data.user.brands),
        ip: data.user.ip ?? null,
        loginAt: data.user.loginAt ? new Date(data.user.loginAt) : null,
        lastActiveAt: expiresAt && new Date(expiresAt - SESSION_MAX_AGE_SECONDS * 1000),
        expiresAt,
      };
    })
    .filter((s) => s.current || !isInternalAddress(s.ip))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt);
}
