/* Organizer routes under /api/v1/admin/events/{eventId}. Every one passes the scope guard first. */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  boxOfficeSaleBody, campaignBody, compBody, detailsPatchBody, gateStaffBody, gateStaffPatchBody, invoiceBody, layoutPutBody, listQuery,
  messageBody, notificationsPatchBody, orderRefundBody, presaleCreateBody, refundDecisionBody, scanBatchBody, scanBody, tierCreateBody, tierPatchBody, toggleBody,
} from '@void/shared';
import { env } from '../config/env.js';
import { Event, User } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/errors.js';
import { idempotent } from '../middleware/idempotency.js';
import { limits } from '../middleware/rateLimit.js';
import { eventScope, gatePermission } from '../middleware/scope.js';
import { badRequest } from '../lib/errors.js';
import { audit, type Actor } from '../lib/platform.js';
import { eventPublicKeys } from '../lib/qr.js';
import * as finance from '../modules/finance/service.js';
import * as gate from '../modules/gate/service.js';
import * as invoices from '../modules/invoices/service.js';
import * as layouts from '../modules/layouts/service.js';
import * as marketing from '../modules/marketing/service.js';
import * as admin from '../modules/orders/admin.js';
import * as orders from '../modules/orders/service.js';
import * as split from '../modules/split/service.js';
import * as tiers from '../modules/tiers/service.js';

export const adminRoutes = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.storage.maxFloorPlanBytes, files: 1 } });

const actor = (req: Request): Actor => ({ id: req.auth!.sub, label: req.auth!.name || req.auth!.email });
const eid = (req: Request) => req.scope!.eventId;
const csv = (res: Response, name: string, body: string) => { res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${name}.csv"`); res.send(body); };

const organizer = [requireAuth, eventScope(['organizer', 'super'])];
const gateStaff = [requireAuth, eventScope(['organizer', 'gate', 'super'])];

/* ---------- Dashboard and analytics ---------- */
adminRoutes.get('/summary', ...organizer, async (req, res) => { res.json(await finance.summary(eid(req))); });
adminRoutes.get('/analytics/weekly', ...organizer, async (req, res) => { res.json({ weekly: await finance.weekly(eid(req)) }); });
adminRoutes.get('/analytics/channels', ...organizer, async (req, res) => { res.json({ channels: await finance.channels(eid(req)) }); });
adminRoutes.get('/analytics/payments', ...organizer, async (req, res) => { res.json({ payments: await finance.payments(eid(req)) }); });
adminRoutes.get('/analytics', ...organizer, async (req, res) => { res.json(await finance.analytics(eid(req))); });
adminRoutes.get('/report.csv', ...organizer, async (req, res) => { csv(res, `${req.scope!.event.slug}-report`, await finance.reportCsv(eid(req))); });

/* ---------- Tiers and codes ---------- */
adminRoutes.get('/tiers', ...organizer, async (req, res) => { res.json(await tiers.listTiers(eid(req))); });
adminRoutes.post('/tiers', ...organizer, idempotent, async (req, res) => { res.status(201).json(await tiers.addTier(eid(req), parse(tierCreateBody, req.body), actor(req))); });
adminRoutes.patch('/tiers/:tierId', ...organizer, async (req, res) => { res.json(await tiers.editTier(eid(req), String(req.params.tierId), parse(tierPatchBody, req.body), actor(req))); });
adminRoutes.patch('/settings/auto-advance', ...organizer, async (req, res) => { res.json(await tiers.setAutoAdvance(eid(req), parse(toggleBody, req.body).on, actor(req))); });
adminRoutes.patch('/settings/waitlist', ...organizer, async (req, res) => { res.json(await tiers.setWaitlist(eid(req), parse(toggleBody, req.body).on, actor(req))); });
adminRoutes.get('/presales', ...organizer, async (req, res) => { res.json({ items: (await tiers.listTiers(eid(req))).presales }); });
adminRoutes.post('/presales', ...organizer, idempotent, async (req, res) => { res.status(201).json(await tiers.createPresale(eid(req), parse(presaleCreateBody, req.body), actor(req))); });
adminRoutes.post('/comps', ...organizer, idempotent, async (req, res) => { res.status(201).json(await tiers.issueComp(eid(req), parse(compBody, req.body), actor(req))); });

/* ---------- Orders ---------- */
adminRoutes.get('/orders', ...organizer, async (req, res) => { res.json(await admin.listOrders(eid(req), parse(listQuery, req.query))); });
adminRoutes.get('/orders.csv', ...organizer, async (req, res) => { csv(res, `${req.scope!.event.slug}-orders`, await admin.ordersCsv(eid(req))); });
adminRoutes.post('/orders/:code/resend', ...organizer, async (req, res) => { res.json(await orders.resendTickets(eid(req), String(req.params.code), actor(req))); });
adminRoutes.post('/orders/:code/refund', ...organizer, idempotent, async (req, res) => { res.json(await orders.refundOrder(eid(req), String(req.params.code), parse(orderRefundBody, req.body ?? {}), actor(req))); });
adminRoutes.get('/refund-requests', ...organizer, async (req, res) => { res.json({ items: await admin.listRefundRequests(eid(req), typeof req.query.status === 'string' ? req.query.status : undefined) }); });
adminRoutes.patch('/refund-requests', ...organizer, idempotent, async (req, res) => { res.json(await admin.decideRefund(eid(req), parse(refundDecisionBody, req.body), actor(req))); });

/* ---------- Split and Koko ---------- */
adminRoutes.get('/splits', ...organizer, async (req, res) => { res.json(await split.listGroups(eid(req))); });
adminRoutes.post('/splits/:id/extend', ...organizer, async (req, res) => { res.json(await split.extendGroup(eid(req), String(req.params.id), actor(req))); });
adminRoutes.post('/splits/:id/release', ...organizer, idempotent, async (req, res) => { res.json(await split.releaseByOrganizer(eid(req), String(req.params.id), actor(req))); });
adminRoutes.get('/koko', ...organizer, async (req, res) => { res.json(await finance.listKoko(eid(req))); });

/* ---------- Layout ---------- */
adminRoutes.get('/layout', ...organizer, async (req, res) => { res.json(await layouts.getLayout(eid(req))); });
adminRoutes.put('/layout', ...organizer, async (req, res) => { res.json(await layouts.saveDraft(eid(req), parse(layoutPutBody, req.body), actor(req))); });
adminRoutes.post('/layout/floor-plan', ...organizer, upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach a JPG or PNG floor plan as "file"');
  res.status(201).json(await layouts.uploadFloorPlan(eid(req), req.file.buffer, actor(req)));
});
adminRoutes.post('/layout/publish', ...organizer, async (req, res) => { res.json(await layouts.publish(eid(req), actor(req))); });

/* ---------- Marketing ---------- */
adminRoutes.get('/campaigns', ...organizer, async (req, res) => { res.json({ items: await marketing.listCampaigns(eid(req)) }); });
adminRoutes.post('/campaigns', ...organizer, async (req, res) => { res.status(201).json(await marketing.createCampaign(eid(req), parse(campaignBody, req.body), actor(req))); });
adminRoutes.post('/messages/preview', ...organizer, async (req, res) => { res.json(await marketing.previewMessage(eid(req), parse(messageBody, req.body))); });
adminRoutes.post('/messages/send', ...organizer, idempotent, async (req, res) => { res.json(await marketing.sendMessage(eid(req), parse(messageBody, req.body), actor(req))); });

/* ---------- Gate ---------- */
adminRoutes.get('/gate/stats', ...gateStaff, async (req, res) => { res.json(await gate.gateStats(eid(req))); });
adminRoutes.get('/gate/keys', ...gateStaff, gatePermission('gateAccess'), async (req, res) => { res.json({ eventId: eid(req), alg: 'Ed25519', format: 'raw-base64url', keys: await eventPublicKeys(eid(req)) }); });
adminRoutes.get('/gate/staff', ...organizer, async (req, res) => { res.json({ items: await gate.listStaff(eid(req)) }); });
adminRoutes.post('/gate/staff', ...organizer, async (req, res) => { res.status(201).json(await gate.addStaff(eid(req), parse(gateStaffBody, req.body), actor(req))); });
adminRoutes.patch('/gate/staff', ...organizer, async (req, res) => { res.json(await gate.patchStaff(eid(req), parse(gateStaffPatchBody, req.body), actor(req))); });
adminRoutes.post('/gate/scan', ...gateStaff, gatePermission('gateAccess'), limits.scans, async (req, res) => { /* An online scan happens now, on the server's clock. Only offline sync carries device timestamps. */
  res.json(await gate.scan(eid(req), req.auth!.sub, { ...parse(scanBody, req.body), scannedAt: undefined })); });
adminRoutes.post('/gate/scan/batch', ...gateStaff, gatePermission('gateAccess'), limits.scans, async (req, res) => { res.json(await gate.scanBatch(eid(req), req.auth!.sub, parse(scanBatchBody, req.body).scans)); });
adminRoutes.post('/gate/box-office/sale', ...gateStaff, gatePermission('boxOffice'), idempotent, async (req, res) => { res.status(201).json(await gate.boxOfficeSale(eid(req), parse(boxOfficeSaleBody, req.body), actor(req))); });

/* ---------- Finance ---------- */
adminRoutes.get('/finance', ...organizer, async (req, res) => { res.json(await finance.finance(eid(req))); });
adminRoutes.get('/payouts', ...organizer, async (req, res) => { res.json({ items: (await finance.finance(eid(req))).payouts }); });
adminRoutes.get('/payouts/:code/statement.csv', ...organizer, async (req, res) => { csv(res, `statement-${String(req.params.code)}`, await finance.statementCsv(eid(req), String(req.params.code))); });
adminRoutes.get('/statement.csv', ...organizer, async (req, res) => { csv(res, `${req.scope!.event.slug}-statement`, await finance.statementCsv(eid(req))); });

/* ---------- Invoices ---------- */
adminRoutes.get('/invoices', ...organizer, async (req, res) => { res.json({ items: await invoices.listInvoices(eid(req)) }); });
adminRoutes.post('/invoices', ...organizer, idempotent, async (req, res) => { res.status(201).json(await invoices.createInvoice(eid(req), parse(invoiceBody, req.body), actor(req))); });
adminRoutes.get('/invoices/:number', ...organizer, async (req, res) => { res.json(await invoices.getInvoice(eid(req), String(req.params.number))); });

/* ---------- Settings ---------- */
adminRoutes.get('/details', ...organizer, async (req, res) => {
  const e = req.scope!.event;
  const me = await User.findById(req.auth!.sub, { notifications: 1 }).lean();
  res.json({ id: String(e._id), name: e.name, about: e.about, playlist: e.playlist?.url ?? '', startsAt: e.startsAt, gatesAt: e.gatesAt, endsAt: e.endsAt, venue: e.venueName, city: e.city, notifications: me?.notifications ?? null, access: { scope: `Organizer workspace. ${e.name}`, rule: 'One admin, one event. You can’t see other events or other admins.' } });
});
adminRoutes.patch('/details', ...organizer, async (req, res) => {
  const b = parse(detailsPatchBody, req.body);
  const set: Record<string, unknown> = {};
  for (const k of ['name', 'about', 'startsAt', 'gatesAt', 'endsAt'] as const) if (b[k] !== undefined) set[k] = b[k];
  if (b.playlist !== undefined) set['playlist.url'] = b.playlist || null;
  const before = req.scope!.event;
  await Event.updateOne({ _id: eid(req) }, { $set: set });
  await audit(actor(req), 'Edited event details', before.name, { eventId: eid(req), before: Object.fromEntries(Object.keys(set).map((k) => [k, (before as never)[k]])), after: set });
  res.json({ ok: true });
});
adminRoutes.patch('/notifications', ...organizer, async (req, res) => {
  const b = parse(notificationsPatchBody, req.body);
  const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined).map(([k, v]) => [`notifications.${k}`, v]));
  const u = await User.findByIdAndUpdate(req.auth!.sub, { $set: set }, { new: true }).lean();
  res.json({ notifications: u?.notifications });
});
