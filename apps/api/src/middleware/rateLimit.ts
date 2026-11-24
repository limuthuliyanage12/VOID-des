/* Rate limits on the routes people (or bots) hammer. Memory store per process; put a Redis store here when running several API instances. */
import rateLimit from 'express-rate-limit';

/* IPv6 addresses are grouped by /64 so one host can't rotate through its block. */
const ipKeyGenerator = (ip: string) => (ip.includes(':') ? ip.split(':').slice(0, 4).join(':') + '::/64' : ip);
import { env } from '../config/env.js';

const make = (windowMs: number, limit: number, message: string, key?: (req: import('express').Request) => string) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  skip: () => env.isTest && !process.env.TEST_RATE_LIMITS,
  keyGenerator: key ?? ((req) => req.auth?.sub ?? ipKeyGenerator(req.ip ?? '')),
  handler: (_req, res) => { res.status(429).json({ code: 'RATE_LIMITED', message }); },
});

export const limits = {
  login: make(15 * 60_000, 10, 'Too many sign-in attempts. Wait 15 minutes and try again.', (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').toLowerCase()}`),
  signup: make(60 * 60_000, 10, 'Too many accounts from here. Try again in an hour.'),
  holds: make(60_000, 30, 'Too many holds at once. Wait a moment.'),
  presale: make(60_000, 10, 'Too many code attempts. Wait a minute.'),
  split: make(60_000, 30, 'Too many requests for share links. Wait a minute.'),
  scans: make(60_000, 600, 'Scanning too fast. Wait a moment.'),
  forms: make(60 * 60_000, 30, 'Too many sign-ups from here. Try again later.'),
};
