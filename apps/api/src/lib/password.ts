/* argon2id hashes, a minimum of 6 characters to match the form, and a breached-password check. */
import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { env } from '../config/env.js';
import { badRequest } from './errors.js';
import { log } from './log.js';

/* OWASP's argon2id baseline: 19 MiB, 2 passes, 1 lane. Algorithm 2 is argon2id. */
const OPTS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = async (stored: string | null | undefined, pw: string) => {
  if (!stored) return false;
  try { return await verify(stored, pw); } catch { return false; }
};

/* A short local list catches the worst passwords without a network call. */
const COMMON = new Set(['123456', '1234567', '12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty', 'qwerty123', 'abc123', '111111', '000000', 'iloveyou', 'letmein', 'welcome', 'admin', 'admin123', 'monkey', 'dragon', 'football', 'sunshine', 'princess', 'srilanka', 'colombo', 'void2027', 'void123']);

/**
 * Have I Been Pwned range API. Only the first five characters of the SHA-1 leave the server (k-anonymity).
 * If the service is down, sign-up carries on: the local list still applies.
 */
export const isBreached = async (pw: string): Promise<boolean> => {
  if (COMMON.has(pw.toLowerCase())) return true;
  if (!env.hibpCheck) return false;
  const sha = createHash('sha1').update(pw).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'void-api' }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const suffix = sha.slice(5);
    return (await res.text()).split('\n').some((line) => { const [s, n] = line.trim().split(':'); return s === suffix && Number(n) > 0; });
  } catch (e) {
    log.warn('breached-password check skipped', { error: (e as Error).message });
    return false;
  }
};

export const assertStrongPassword = async (pw: string) => {
  if (pw.length < 6) throw badRequest('Use at least 6 characters');
  if (await isBreached(pw)) throw badRequest('That password has appeared in a data breach. Choose another one.', { field: 'password' });
};
