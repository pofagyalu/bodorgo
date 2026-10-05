import crypto from 'crypto';
import config from '../config.js';

// Secrets kept in the database (the OIDC client secret, the Authentik API
// token - see utils/oidcSettings.js) are encrypted with a key that is only
// in the server's .env (APP_SECRET_KEY): a database dump alone gives none of
// them away. AES-256-GCM; stored as "v1:<iv>:<tag>:<data>", each base64.

const key = () =>
  Buffer.from(crypto.hkdfSync('sha256', config.appSecretKey, '', 'bodorgo-settings', 32));

export const canEncrypt = () => !!config.appSecretKey;

export function encryptSecret(plain) {
  if (!canEncrypt()) throw new Error('APP_SECRET_KEY is not set');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((part) => (Buffer.isBuffer(part) ? part.toString('base64') : part))
    .join(':');
}

// Throws when the key is missing or not the one it was encrypted with.
export function decryptSecret(stored) {
  if (!canEncrypt()) throw new Error('APP_SECRET_KEY is not set');
  const [version, iv, tag, data] = String(stored).split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unknown format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
