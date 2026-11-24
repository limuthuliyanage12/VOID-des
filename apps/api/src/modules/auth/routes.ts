import { Router } from 'express';
import { z } from 'zod';
import { googleBody, loginBody, password, signupBody, totpVerifyBody } from '@void/shared';
import { User, type UserDoc } from '../../db/models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { parse } from '../../middleware/errors.js';
import { limits } from '../../middleware/rateLimit.js';
import { unauthorized } from '../../lib/errors.js';
import * as svc from './service.js';

export const authRoutes = Router();

authRoutes.post('/signup', limits.signup, async (req, res) => { res.status(201).json(await svc.signup(parse(signupBody, req.body), res)); });
authRoutes.post('/login', limits.login, async (req, res) => { res.json(await svc.login(parse(loginBody, req.body), res)); });
authRoutes.post('/refresh', async (req, res) => { res.json(await svc.refresh(req.cookies?.[svc.REFRESH_COOKIE], res)); });
authRoutes.post('/logout', async (req, res) => { await svc.logout(req.cookies?.[svc.REFRESH_COOKIE], res); res.status(204).end(); });
authRoutes.get('/google/start', async (_req, res) => { res.json(svc.googleStart(res)); });
authRoutes.post('/google', limits.login, async (req, res) => { res.json(await svc.googleFinish(parse(googleBody, req.body), req.cookies?.void_g, res)); });
authRoutes.post('/invite/accept', limits.login, async (req, res) => {
  const b = parse(z.object({ token: z.string().min(16), password }), req.body);
  res.json(await svc.acceptInvite(b.token, b.password, res));
});

authRoutes.get('/me', requireAuth, async (req, res) => {
  const u = await User.findById(req.auth!.sub).lean<UserDoc>();
  if (!u) throw unauthorized();
  res.json({ user: svc.sessionUser(u, req.auth!.mfa), mfaEnabled: !!u.totp?.enabled });
});
authRoutes.post('/totp/setup', requireAuth, async (req, res) => { res.json(await svc.totpSetup(req.auth!.sub)); });
authRoutes.post('/totp/verify', requireAuth, async (req, res) => { res.json(await svc.totpVerify(req.auth!.sub, parse(totpVerifyBody, req.body).otp, res)); });
