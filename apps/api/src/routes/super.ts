/* Super admin routes under /api/v1/super. Only role super, with a second factor when REQUIRE_MFA is on. */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { adminInviteBody, breachBody, feesBody, listQuery, markPaidBody, noteBody, privacyDecisionBody, settingsPatchBody, venueBody } from '@void/shared';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parse } from '../middleware/errors.js';
import { idempotent } from '../middleware/idempotency.js';
import { badRequest } from '../lib/errors.js';
import type { Actor } from '../lib/platform.js';
import { putFile } from '../lib/storage.js';
import * as finance from '../modules/finance/service.js';
import * as layouts from '../modules/layouts/service.js';
import * as p from '../modules/platform/service.js';
import { listVenues } from '../modules/events/service.js';

export const superRoutes = Router();
superRoutes.use(requireAuth, requireRole('super'));
const actor = (req: Request): Actor => ({ id: req.auth!.sub, label: 'Super admin' });
const csv = (res: Response, name: string, body: string) => { res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${name}.csv"`); res.send(body); };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.storage.maxModelBytes, files: 1 } });

superRoutes.get('/overview', async (_req, res) => { res.json(await p.overview()); });
superRoutes.get('/report.csv', async (_req, res) => { csv(res, 'void-platform-report', await p.overviewCsv()); });

superRoutes.get('/events', async (req, res) => { res.json(await p.listEvents(parse(listQuery, req.query))); });
superRoutes.get('/events/:id', async (req, res) => { res.json(await p.eventDetail(String(req.params.id))); });
superRoutes.post('/events/:id/approve', idempotent, async (req, res) => { res.json(await p.decideEvent(String(req.params.id), 'live', parse(noteBody, req.body ?? {}).note, actor(req))); });
superRoutes.post('/events/:id/reject', idempotent, async (req, res) => { res.json(await p.decideEvent(String(req.params.id), 'rejected', parse(noteBody, req.body ?? {}).note, actor(req))); });
superRoutes.post('/events/:id/suspend', idempotent, async (req, res) => { res.json(await p.suspend(String(req.params.id), actor(req))); });
superRoutes.post('/events/:id/restore', idempotent, async (req, res) => { res.json(await p.restore(String(req.params.id), actor(req))); });

superRoutes.get('/admins', async (_req, res) => { res.json({ items: await p.listAdmins(), rule: 'One admin per event. An admin sees only their event.' }); });
superRoutes.post('/admins/invite', idempotent, async (req, res) => { res.status(201).json(await p.inviteAdmin(parse(adminInviteBody, req.body), actor(req))); });

superRoutes.get('/venues', async (_req, res) => { res.json({ items: await listVenues() }); });
superRoutes.post('/venues', async (req, res) => { res.status(201).json(await p.createVenue(parse(venueBody, req.body), actor(req))); });
superRoutes.post('/venues/:id/model', upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach a GLB model as "file"');
  const f = await putFile('model', String(req.params.id), req.file.buffer);
  res.status(201).json(await p.setVenueModel(String(req.params.id), f.url, actor(req)));
});
superRoutes.get('/layouts', async (req, res) => { res.json({ items: await layouts.listForReview(typeof req.query.status === 'string' ? req.query.status : undefined) }); });
superRoutes.post('/layouts/:id/approve', idempotent, async (req, res) => { res.json(await layouts.approve(String(req.params.id), actor(req))); });
superRoutes.post('/layouts/:id/request-changes', async (req, res) => { res.json(await layouts.requestChanges(String(req.params.id), parse(noteBody, req.body ?? {}).note, actor(req))); });

superRoutes.get('/revenue', async (_req, res) => { res.json(await finance.revenue()); });
superRoutes.get('/revenue.csv', async (_req, res) => { csv(res, 'void-revenue', await finance.revenueCsv()); });
superRoutes.get('/payouts', async (_req, res) => { res.json(await finance.listPayouts()); });
superRoutes.post('/payouts/:code/approve', idempotent, async (req, res) => { res.json(await finance.approvePayout(String(req.params.code), actor(req))); });
superRoutes.post('/payouts/:code/mark-paid', idempotent, async (req, res) => { res.json(await finance.markPayoutPaid(String(req.params.code), parse(markPaidBody, req.body).bankRef, actor(req))); });

superRoutes.get('/settings/fees', async (_req, res) => { res.json(await p.getFees()); });
superRoutes.patch('/settings/fees', async (req, res) => { res.json(await p.setFees(parse(feesBody, req.body).bookingFeePercent, actor(req))); });
superRoutes.get('/settings', async (_req, res) => { res.json(await p.platformSettings()); });
superRoutes.patch('/settings', async (req, res) => { res.json(await p.patchSettings(parse(settingsPatchBody, req.body), actor(req))); });
superRoutes.get('/users', async (req, res) => { res.json(await p.listUsers(parse(listQuery, req.query))); });
superRoutes.get('/audit', async (req, res) => { res.json(await p.listAudit(parse(listQuery.extend({ eventId: z.string().optional() }), req.query))); });
superRoutes.get('/audit.csv', async (_req, res) => { csv(res, 'void-audit-log', await p.auditCsv()); });

superRoutes.get('/privacy/requests', async (req, res) => { res.json({ items: await p.listPrivacyRequests(typeof req.query.status === 'string' ? req.query.status : undefined) }); });
superRoutes.patch('/privacy/requests/:id', async (req, res) => { res.json(await p.decidePrivacyRequest(String(req.params.id), parse(privacyDecisionBody, req.body), actor(req))); });
superRoutes.get('/breaches', async (_req, res) => { res.json({ items: await p.listBreaches() }); });
superRoutes.post('/breaches', async (req, res) => { res.status(201).json(await p.logBreach(parse(breachBody, req.body), actor(req))); });
