import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/** A random URL-safe token. 32 bytes gives 256 bits. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const key = (): Buffer => {
  const raw = Buffer.from(env.dataKey, 'base64');
  return raw.length === 32 ? raw : createHash('sha256').update(env.dataKey).digest();
};

/** AES-256-GCM. Output is iv.tag.ciphertext in base64url. */
export const encrypt = (plain: string): string => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
};

export const decrypt = (packed: string): string => {
  const [iv, tag, body] = packed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
};

/**
 * A token the server can recompute without storing it: HMAC of purpose, id and version under the data key.
 * Unguessable without the key; look-ups store only its SHA-256. Bump the version to rotate one.
 */
export const derivedToken = (purpose: string, id: string, version = 1): string =>
  createHmac('sha256', key()).update(`${purpose}:${id}:${version}`).digest('base64url');
