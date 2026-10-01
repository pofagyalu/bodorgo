import crypto from 'crypto';
import config from '../config.js';

// Futókör: a card's link. The QR code (and later the NFC sticker) carries
// <the app>/fk/<token>, where the token is the card's id and a
// signature: "T05.k3J9xQ...". The id can be read by anyone (the phone does,
// offline); only this server can tell a real card from a made-up one.

const sign = (tagId) =>
  crypto
    .createHmac('sha256', config.futokor.tagSecret)
    .update(String(tagId))
    .digest('base64url')
    .slice(0, 16);

export const tagToken = (tagId) => `${tagId}.${sign(tagId)}`;

// The card's id, if the token is a real one - null otherwise.
export function verifyTagToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const tagId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const real = Buffer.from(sign(tagId));
  return given.length === real.length && crypto.timingSafeEqual(given, real) ? tagId : null;
}

export const tagUrl = (tagId) =>
  `${(config.oridzs.clientBaseUrl || 'https://bodorgo.hu').replace(/\/+$/, '')}/fk/${tagToken(tagId)}`;
