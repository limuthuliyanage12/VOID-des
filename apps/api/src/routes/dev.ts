/*
 * Demo-mode helpers under /api/v1/dev. Mounted only when DEMO_MODE is on, which is impossible in production.
 * They post correctly signed provider callbacks through the real webhook code, so the whole payment path runs.
 */
import { Router } from 'express';
import { env } from '../config/env.js';
import { Event, Scan, Ticket } from '../db/models/index.js';
import { tokenForTicket } from '../lib/qr.js';
import { resolveEvent } from '../middleware/scope.js';
import { z } from 'zod';
import { Order, SplitGroup, SplitShare, type OrderDoc } from '../db/models/index.js';
import { parse } from '../middleware/errors.js';
import { notFound } from '../lib/errors.js';
import { jobs } from '../lib/jobs.js';
import { mockKoko } from '../lib/koko.js';
import { readOutbox } from '../lib/notify.js';
import { signedNotify } from '../lib/payhere.js';
import { handleKokoCallback, handlePayhereNotify } from '../modules/payments/service.js';

export const devRoutes = Router();

const amountFor = async (providerOrderId: string) => {
  const m = /^(VOID-\d{7})(?:-S(\d))?$/.exec(providerOrderId);
  const o = m ? await Order.findOne({ code: m[1] }).lean<OrderDoc>() : null;
  if (!o || !m) throw notFound('Order');
  if (m[2] == null) return o.totalCents;
  const s = await SplitShare.findOne({ orderId: o._id, index: Number(m[2]) }).lean();
  if (!s) throw notFound('Share');
  return s.amountCents;
};

/** Simulates PayHere's server callback for an order (VOID-2701843) or a share (VOID-2701843-S1). */
devRoutes.post('/payhere/complete', async (req, res) => {
  const b = parse(z.object({ orderId: z.string(), statusCode: z.enum(['2', '0', '-1', '-2', '-3']).default('2'), paymentId: z.string().optional() }), req.body);
  const body = signedNotify({ orderId: b.orderId, amountCents: await amountFor(b.orderId), statusCode: b.statusCode, paymentId: b.paymentId });
  const r = await handlePayhereNotify(body);
  await jobs.flush();
  res.json({ ...r, paymentId: body.payment_id });
});

/** The page the mock Koko driver redirects to: approve or decline the 3-instalment plan. */
devRoutes.get('/koko/approve', (req, res) => {
  const q = new URLSearchParams(req.query as Record<string, string>).toString();
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Koko (demo)</title><body style="background:#000;color:#f2f2f2;font:16px Inter,system-ui;display:grid;place-items:center;height:100vh;margin:0"><form method="post" action="?${q}" style="text-align:center"><p>Koko demo. Pay a third today and the rest in two monthly payments.</p><p>Amount LKR ${(Number(req.query.amount) / 100).toLocaleString('en-US')}</p><button name="status" value="approved" style="padding:12px 24px;border-radius:99px">Approve plan</button> <button name="status" value="declined" style="padding:12px 24px;border-radius:99px">Decline</button></form>`);
});
devRoutes.post('/koko/approve', async (req, res) => {
  const k = mockKoko();
  if (!k) throw notFound('Mock Koko');
  const status = (req.body?.status === 'declined' ? 'declined' : 'approved') as 'approved' | 'declined';
  const orderId = String(req.query.order), kokoRef = String(req.query.ref);
  const { body, signature } = k.signedCallback({ orderId, kokoRef, status, amountCents: await amountFor(orderId) });
  const r = await handleKokoCallback(body, signature, JSON.parse(body));
  await jobs.flush();
  const back = typeof req.query.return === 'string' && req.query.return.startsWith(env.webOrigin) ? req.query.return : null;
  if (back && req.accepts('html')) return void res.redirect(303, status === 'approved' ? back : back.replace(/confirmation\.html.*$/, 'index.html#events'));
  if (req.accepts('html')) return void res.type('html').send(`<!doctype html><meta charset="utf-8"><body style="background:#000;color:#f2f2f2;font:16px Inter,system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>Koko ${status}. Result: ${r.result}. You can close this tab.</p>`);
  res.json(r);
});

/** Email and SMS the log drivers would have sent: split links, tickets, invites. */
devRoutes.get('/outbox', (req, res) => { res.json({ items: readOutbox(Number(req.query.limit) || 50) }); });

/** Runs a job now: sweep, tierAdvance, preparePayouts, dailyDigest, scrubPersonalData, kokoSync... */
devRoutes.post('/jobs/:name', async (req, res) => { res.json({ result: (await jobs.runNow(String(req.params.name), req.body ?? {})) ?? null }); });

/** Moves a split group's deadline into the past and runs expiry, to demo release and refunds. */
devRoutes.post('/split/:code/expire-now', async (req, res) => {
  const g = await SplitGroup.findOneAndUpdate({ code: String(req.params.code).toUpperCase(), status: 'open' }, { $set: { expiresAt: new Date(Date.now() - 1000) } }, { new: true });
  if (!g) throw notFound('Open split group');
  await jobs.runNow('expireSplit', { groupId: String(g._id) });
  res.json({ code: g.code, status: (await SplitGroup.findById(g._id).lean())?.status });
});

/** A real, signed QR for a valid ticket at this event, so the console's demo scanner scans something genuine. */
devRoutes.get('/events/:id/sample-qr', async (req, res) => {
  const e = await resolveEvent(String(req.params.id));
  if (!e) throw notFound('Event');
  const used = await Scan.distinct('ticketId', { eventId: e._id, result: 'admitted' });
  const t = await Ticket.findOne({ eventId: e._id, status: 'valid', _id: { $nin: used } }).sort({ createdAt: -1 }).lean();
  if (!t) throw notFound('A valid ticket that has not been scanned');
  res.json({ token: await tokenForTicket(t as never), holderName: t.holderName, line: t.line, admits: t.admits });
});
void Event;
