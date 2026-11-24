import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { adminRoutes } from './routes/admin.js';
import { devRoutes } from './routes/dev.js';
import { publicRoutes } from './routes/public.js';
import { superRoutes } from './routes/super.js';
import { webhookRoutes } from './routes/webhooks.js';
import { requireAuth } from './middleware/auth.js';
import { Event } from './db/models/index.js';
import { forbidden } from './lib/errors.js';

/* Only the payment origins checkout needs, plus the CDNs the prototype pages load. */
const PAY = ['https://sandbox.payhere.lk', 'https://www.payhere.lk', 'https://qaapi.paykoko.com', 'https://prodapi.paykoko.com'];

export const createApp = () => {
  const app = express();
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', ...(env.storage.publicUrl ? [env.storage.publicUrl] : [])],
        'connect-src': ["'self'", ...env.corsOrigins, ...PAY.filter((u) => u.includes('koko'))],
        'form-action': ["'self'", ...PAY],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': env.isProd ? [] : null,
      },
    },
    hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: (o, cb) => cb(null, !o || env.corsOrigins.includes(o)), credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Hold-Secret', 'X-Order-Token'] }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as express.Request).rawBody = buf.toString('utf8'); } }));
  /* PayHere posts its notify as a form. */
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(authenticate);

  app.get('/healthz', (_req, res) => { res.json({ ok: true }); });
  app.get('/readyz', (_req, res) => { const up = mongoose.connection.readyState === 1; res.status(up ? 200 : 503).json({ ok: up, db: up ? 'up' : 'down' }); });

  const v1 = express.Router();
  v1.use('/auth', authRoutes);
  v1.use('/webhooks', webhookRoutes);
  /* The organizer's own workspace: which event they are locked to. */
  v1.get('/admin/workspace', requireAuth, async (req, res) => {
    if (req.auth!.role !== 'organizer' && req.auth!.role !== 'gate') throw forbidden();
    const e = await Event.findById(req.auth!.eid, { name: 1, slug: 1, startsAt: 1 }).lean();
    res.json({ event: e ? { id: String(e._id), slug: e.slug, name: e.name, startsAt: e.startsAt } : null, rule: 'One admin, one event. You can’t see other events or other admins.' });
  });
  v1.use('/admin/events/:eventId', adminRoutes);
  v1.use('/super', superRoutes);
  if (env.demoMode) v1.use('/dev', devRoutes);
  v1.use(publicRoutes);
  app.use('/api/v1', v1, notFoundHandler);

  if (env.storage.driver === 'local') app.use('/uploads', express.static(env.storage.localDir, { fallthrough: false, maxAge: '7d' }));
  if (env.serveWeb) app.use(express.static(env.webDir, { extensions: ['html'] }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
