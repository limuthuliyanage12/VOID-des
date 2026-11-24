/* Public and fan routes under /api/v1. */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { checkoutBody, email, eventsQuery, holdBody, mobile, newsletterBody, notifyBody, personName, presaleBody, privacyRequestBody, refundRequestBody, transferBody } from '@void/shared';
import { env } from '../config/env.js';
import { requireAuth, softAuth } from '../middleware/auth.js';
import { parse } from '../middleware/errors.js';
import { idempotent } from '../middleware/idempotency.js';
import { limits } from '../middleware/rateLimit.js';
import { AppError, forbidden } from '../lib/errors.js';
import { walletUnavailableMessage } from '../lib/wallet.js';
import * as events from '../modules/events/service.js';
import * as holds from '../modules/holds/service.js';
import * as marketing from '../modules/marketing/service.js';
import * as orders from '../modules/orders/service.js';
import * as split from '../modules/split/service.js';
import * as tickets from '../modules/tickets/service.js';
import * as users from '../modules/users/service.js';

export const publicRoutes = Router();
const viewToken = (req: Request) => (typeof req.query.t === 'string' ? req.query.t : req.header('X-Order-Token') ?? undefined);
const fanOnly = (req: Request) => { if (req.auth && req.auth.role !== 'fan') throw forbidden('Staff accounts can’t buy tickets. Sign out to book as a guest.'); };

/* ---------- Browse ---------- */
publicRoutes.get('/events', async (req, res) => { res.json(await events.listEvents(parse(eventsQuery, req.query))); });
publicRoutes.get('/events/:id', async (req, res) => { res.json(await events.eventDetail(String(req.params.id))); });
publicRoutes.get('/events/:id/tables', async (req, res) => { res.json(await events.eventTables(String(req.params.id))); });
publicRoutes.get('/venues', async (_req, res) => { res.json({ items: await events.listVenues() }); });
publicRoutes.get('/venues/:id', async (req, res) => { res.json(await events.venueDetail(String(req.params.id))); });
publicRoutes.post('/events/:id/notify', limits.forms, async (req, res) => { res.status(201).json(await events.joinNotifyList(String(req.params.id), parse(notifyBody, req.body))); });
publicRoutes.post('/events/:id/presale', limits.presale, async (req, res) => { res.json(await events.checkPresale(String(req.params.id), parse(presaleBody, req.body).code)); });
publicRoutes.post('/newsletter', limits.forms, async (req, res) => { res.status(201).json(await marketing.subscribe(parse(newsletterBody, req.body).email)); });
publicRoutes.get('/newsletter/unsubscribe', async (req, res) => {
  await marketing.unsubscribe(String(req.query.e ?? ''), String(req.query.t ?? ''));
  res.type('html').send('<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><body style="background:#000;color:#f2f2f2;font:16px Inter,system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>You’re unsubscribed. We won’t email you about events again.</p>');
});

/* ---------- Tracked links ---------- */
publicRoutes.get('/r/:ref', async (req, res) => {
  const r = await marketing.trackClick(String(req.params.ref));
  if (r.ref) res.cookie('void_ref', r.ref, { httpOnly: true, sameSite: 'lax', secure: env.isProd, maxAge: 30 * 86_400_000, path: '/' });
  res.redirect(302, r.url);
});

/* ---------- Holds and checkout ---------- */
publicRoutes.post('/holds', limits.holds, softAuth, idempotent, async (req, res) => {
  fanOnly(req);
  res.status(201).json(await holds.createHold(parse(holdBody, req.body), { userId: req.auth?.sub ?? null }));
});
publicRoutes.delete('/holds/:id', softAuth, async (req, res) => {
  const secret = req.header('X-Hold-Secret') ?? String(req.body?.secret ?? '');
  if (!secret) throw new AppError(400, 'BAD_REQUEST', 'Send the hold secret in X-Hold-Secret');
  await holds.releaseByBuyer(String(req.params.id), secret); res.status(204).end();
});
publicRoutes.post('/checkout', limits.holds, softAuth, idempotent, async (req, res) => {
  res.status(201).json(await orders.checkout(parse(checkoutBody, req.body), req.auth, req.cookies?.void_ref));
});

/* ---------- Orders ---------- */
publicRoutes.get('/orders/:code', softAuth, async (req, res) => {
  const { order, lead } = await orders.loadOrderFor(String(req.params.code), req.auth, viewToken(req));
  res.json(await orders.orderView(order, { lead }));
});
publicRoutes.post('/orders/:code/refund-request', softAuth, idempotent, async (req, res) => {
  res.status(201).json(await orders.requestRefund(String(req.params.code), req.auth, viewToken(req), parse(refundRequestBody, req.body)));
});

/* ---------- Split pay ---------- */
publicRoutes.get('/split/:token', limits.split, async (req, res) => { res.json(await split.viewShare(String(req.params.token))); });
publicRoutes.post('/split/:token/pay', limits.split, idempotent, async (req, res) => {
  res.json(await split.payByToken(String(req.params.token), parse(z.object({ name: personName, email, mobile }), req.body)));
});

/* ---------- Tickets ---------- */
publicRoutes.get('/me/tickets', requireAuth, async (req, res) => { res.json(await tickets.myTickets(req.auth!)); });
/** The ticket's own signed QR token, passed as ?q=, proves access for links that can't carry a Bearer token. */
const byQr = async (id: string, q: unknown) => {
  if (typeof q !== 'string' || !q) return null;
  const { verifyToken, eventPublicKeys, peekToken } = await import('../lib/qr.js');
  const p = peekToken(q);
  if (!p || p.t !== id || !verifyToken(q, await eventPublicKeys(p.e))) return null;
  const { Ticket } = await import('../db/models/index.js');
  return Ticket.findById(id).lean();
};
publicRoutes.get('/tickets/:id/pdf', softAuth, async (req, res) => {
  const t = (await byQr(String(req.params.id), req.query.q)) ?? await tickets.loadTicketFor(String(req.params.id), req.auth, viewToken(req));
  const pdf = await tickets.ticketPdfFor(t);
  res.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${t.orderCode}.pdf"`);
  res.send(pdf);
});
publicRoutes.get('/tickets/:id/qr.svg', softAuth, async (req, res) => {
  const { qrSvg, tokenForTicket, verifyToken, eventPublicKeys, peekToken } = await import('../lib/qr.js');
  /* An <img> can't send a Bearer token, so the ticket's own signed QR token also proves access to its picture. */
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const peek = q ? peekToken(q) : null;
  if (peek && peek.t === String(req.params.id) && verifyToken(q, await eventPublicKeys(peek.e))) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return void res.type('image/svg+xml').send(await qrSvg(q));
  }
  const t = await tickets.loadTicketFor(String(req.params.id), req.auth, viewToken(req));
  if (t.status !== 'valid') throw new AppError(410, 'GONE', 'This ticket is no longer valid');
  res.type('image/svg+xml').send(await qrSvg(await tokenForTicket(t as never)));
});
publicRoutes.get('/tickets/:id/wallet', softAuth, async (req, res) => {
  await tickets.loadTicketFor(String(req.params.id), req.auth, viewToken(req));
  res.status(501).json({ code: 'WALLET_UNAVAILABLE', message: walletUnavailableMessage, pdf: `${env.apiPublicUrl}/api/v1/tickets/${String(req.params.id)}/pdf` });
});
publicRoutes.post('/tickets/:id/transfer', requireAuth, idempotent, async (req, res) => { res.status(201).json(await tickets.startTransfer(String(req.params.id), req.auth!, parse(transferBody, req.body))); });
publicRoutes.post('/transfers/:token/accept', softAuth, async (req, res) => { res.json(await tickets.acceptTransfer(String(req.params.token), req.auth)); });

/* ---------- Your data (PDPA) ---------- */
publicRoutes.get('/me/data', requireAuth, async (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="void-my-data.json"');
  res.json(await users.exportMyData(req.auth!));
});
publicRoutes.delete('/me', requireAuth, async (req, res) => { res.json(await users.deleteMe(req.auth!)); });
publicRoutes.post('/privacy/requests', limits.forms, softAuth, async (req, res) => { res.status(201).json(await users.submitPrivacyRequest(parse(privacyRequestBody, req.body), req.auth)); });
