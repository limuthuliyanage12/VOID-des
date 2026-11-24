/*
 * Checkout turns a hold into a pending order and returns what the browser needs to pay:
 * PayHere form fields with the server-made hash, or a Koko redirect. Nothing is "paid" until a verified callback says so.
 */
import { Types } from 'mongoose';
import { calcOrder, RULES, splitShares, VIP, type CheckoutBody, type OrderView } from '@void/shared';
import { env } from '../../config/env.js';
import { tx } from '../../db/connect.js';
import { Event, Hold, KokoPlan, Order, Payment, RefundRequest, SplitGroup, SplitShare, Ticket, type EventDoc, type OrderDoc, type TicketDoc } from '../../db/models/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, gone, notFound } from '../../lib/errors.js';
import { koko } from '../../lib/koko.js';
import { log } from '../../lib/log.js';
import { sendEmail, sendSms, templates } from '../../lib/notify.js';
import { buildCheckout } from '../../lib/payhere.js';
import { audit, getSettings, nextOrderCode, type Actor } from '../../lib/platform.js';
import type { AccessClaims } from '../../lib/tokens.js';
import { assertBookable, getHoldForBuyer } from '../holds/service.js';
import { refundPaymentRecord } from '../payments/service.js';
import { createGroupIn, shareLink, shareToken } from '../split/service.js';
import { checkViewToken, emailViewToken, ticketPdfFor, ticketView, voidTicketsIn } from '../tickets/service.js';

const web = (p: string) => `${env.webOrigin}/${p}`;

export const checkout = async (b: CheckoutBody, a: AccessClaims | undefined, cookieRef?: string) => {
  if (a && a.role !== 'fan') throw forbidden('Staff accounts can’t buy tickets. Sign out to book as a guest.');
  const hold = await getHoldForBuyer(b.holdId, b.holdSecret);
  if (hold.status !== 'active' || hold.expiresAt.getTime() <= Date.now()) throw gone('Your hold has run out. Pick your tickets again.');
  const event = await Event.findById(hold.eventId).lean<EventDoc>();
  if (!event) throw notFound('Event');
  assertBookable(event);
  if (b.split && hold.orderId) throw conflict('Checkout has already started for this hold');

  const settings = await getSettings();
  const isTable = hold.kind === 'table';
  const qty = isTable ? 1 : hold.qty;
  const maths = calcOrder({ qty, unitCents: hold.unitCents, feePercent: settings.bookingFeePercent });
  const split = b.split ? splitShares(maths.totalCents, b.split.size) : null;
  const seats = isTable ? VIP[hold.tableCode!.startsWith('G') ? 'gold' : 'platinum'].seats : undefined;
  const viewToken = randomToken(24);

  /* A second checkout on the same hold (the buyer went back) reuses the pending order with the new details. */
  const order = await tx(async (session) => {
    const h = await Hold.findOne({ _id: hold._id, status: 'active' }, null, { session });
    if (!h) throw gone('Your hold has run out. Pick your tickets again.');
    if (h.orderId) {
      const existing = await Order.findOneAndUpdate({ _id: h.orderId, status: 'pending', payMethod: { $ne: 'split' } },
        { $set: { buyer: b.buyer, payMethod: b.payMethod, viewTokenHash: sha256(viewToken), marketingConsent: b.marketingConsent, ...maths } }, { new: true, session });
      if (!existing) throw conflict('A payment is already under way for this hold');
      return existing;
    }
    const code = await nextOrderCode(session);
    const [o] = await Order.create([{
      code, eventId: event._id, buyer: b.buyer, userId: a?.sub ?? null,
      lines: [{ kind: hold.presaleCodeId ? 'presale' : hold.kind, tierId: hold.tierId, tableId: hold.tableId, tableCode: hold.tableCode, presaleCodeId: hold.presaleCodeId, label: hold.label, qty, unitCents: hold.unitCents, seats }],
      line: hold.label, qty: isTable ? 1 : hold.qty, admits: isTable ? seats! : hold.qty, ...maths,
      payMethod: split ? 'split' : b.payMethod, status: 'pending', source: b.source ?? cookieRef ?? null, holdId: hold._id,
      viewTokenHash: sha256(viewToken), marketingConsent: b.marketingConsent,
    }], { session });
    await Hold.updateOne({ _id: hold._id }, { $set: { orderId: o._id } }, { session });
    if (split) {
      const g = await createGroupIn(o, split, b.split!.friends ?? [], a?.sub ?? null, session);
      await Order.updateOne({ _id: o._id }, { $set: { splitGroupId: g._id } }, { session });
      o.splitGroupId = g._id;
    }
    return o;
  });

  const returnUrl = web(`confirmation.html?order=${order.code}&t=${viewToken}`);
  const cancelUrl = web(event.legacyId != null ? `event.html#e${event.legacyId}` : `event.html?event=${event.slug}`);
  const items = `${event.name} · ${hold.label}`;
  let payment;
  if (split) {
    payment = buildCheckout({ orderId: `${order.code}-S0`, amountCents: split.leadShareCents, items: `${items} · your share`, buyer: b.buyer, returnUrl, cancelUrl, custom1: 'share', custom2: '0' });
  } else if (b.payMethod === 'koko') {
    const s = await koko().createSession({ orderId: order.code, amountCents: order.totalCents, currency: 'LKR', buyer: b.buyer, returnUrl, cancelUrl, responseUrl: `${env.apiPublicUrl}/api/v1/webhooks/koko` });
    await KokoPlan.updateOne({ orderId: order._id }, { $set: { kokoRef: s.kokoRef, amountCents: order.totalCents, instalments: settings.kokoInstalments, status: 'pending approval' } }, { upsert: true });
    payment = { provider: 'koko' as const, redirectUrl: s.redirectUrl };
  } else {
    payment = buildCheckout({ orderId: order.code, amountCents: order.totalCents, items, buyer: b.buyer, returnUrl, cancelUrl, custom1: 'order' });
  }

  return {
    order: await orderView(order.toObject() as OrderDoc, { lead: true }),
    viewToken, payment, holdExpiresAt: hold.expiresAt.toISOString(),
    ...(env.demoMode ? { demo: { note: 'Demo mode. POST /api/v1/dev/payhere/complete with this order id to simulate the PayHere callback.', providerOrderId: split ? `${order.code}-S0` : order.code } } : {}),
  };
};

/* ---------- Reading an order ---------- */
export const orderView = async (o: OrderDoc, opts: { lead?: boolean; withQr?: boolean } = {}): Promise<OrderView> => {
  const e = await Event.findById(o.eventId, { name: 1, startsAt: 1, gatesAt: 1, endsAt: 1, venueName: 1, city: 1, art: 1 }).lean<EventDoc>();
  const g = o.splitGroupId ? await SplitGroup.findById(o.splitGroupId).lean() : null;
  const shares = g ? await SplitShare.find({ groupId: g._id }).sort({ index: 1 }).lean() : [];
  const tickets = o.ticketsIssuedAt ? await Ticket.find({ orderId: o._id }).lean<TicketDoc[]>() : [];
  return {
    code: o.code, status: o.status, payMethod: o.payMethod,
    event: { id: String(o.eventId), name: e?.name ?? '', startsAt: e?.startsAt?.toISOString() ?? '', venue: e?.venueName ?? '', city: e?.city ?? '' },
    buyer: { name: o.buyer.name, email: o.buyer.email }, line: o.line, qty: o.qty, admits: o.admits,
    subtotalCents: o.subtotalCents, feePercent: o.feePercent, feeCents: o.feeCents, totalCents: o.totalCents,
    split: g ? {
      code: g.code, size: g.size, shareCents: g.shareCents, leadShareCents: g.leadShareCents, expiresAt: g.expiresAt?.toISOString() ?? null, status: g.status,
      shares: shares.map((s) => ({ index: s.index, name: s.index === 0 ? o.buyer.name : s.name || `Friend ${s.index}`, status: s.status, amountCents: s.amountCents, ...(opts.lead && s.index > 0 && s.status === 'waiting' ? { link: shareLink(shareToken(s._id)) } : {}) })),
    } : null,
    tickets: e ? await Promise.all(tickets.map((t) => ticketView(t, e as never, opts.withQr !== false))) : [],
  };
};

export const loadOrderFor = async (code: string, a: AccessClaims | undefined, viewToken?: string) => {
  const o = await Order.findOne({ code: code.toUpperCase() }).lean<OrderDoc>();
  if (!o) throw notFound('Order');
  const owner = !!a && (String(o.userId) === a.sub || o.buyer.email === a.email);
  const staff = !!a && (a.role === 'super' || (a.role === 'organizer' && a.eid === String(o.eventId)));
  const byToken = checkViewToken(o, viewToken);
  if (!owner && !staff && !byToken) throw notFound('Order');
  return { order: o, lead: owner || byToken };
};

/* ---------- Refund requests from fans, decided by the organizer ---------- */
export const requestRefund = async (code: string, a: AccessClaims | undefined, viewToken: string | undefined, b: { reason: string; ticketIds?: string[] }) => {
  const { order } = await loadOrderFor(code, a, viewToken);
  if (order.status !== 'paid' && order.status !== 'partially refunded') throw conflict('Only a paid order can be refunded');
  if (await RefundRequest.exists({ orderId: order._id, status: 'requested' })) throw conflict('A refund request for this order is already with the organizer');
  const r = await RefundRequest.create({ orderId: order._id, eventId: order.eventId, requestedBy: a?.sub ?? null, requesterEmail: order.buyer.email, reason: b.reason, ticketIds: b.ticketIds ?? [], status: 'requested' });
  await audit({ id: a?.sub ?? null, label: order.buyer.name }, 'Requested refund', order.code, { eventId: order.eventId, result: 'Requested' });
  return { id: String(r._id), status: r.status };
};

/**
 * Refund to the original method and void the matching tickets so they fail at the gate.
 * Partial refunds void only the chosen tickets; a party pass or table refunds whole. Split orders refund every share.
 */
export const refundOrder = async (eventId: string, code: string, b: { ticketIds?: string[]; reason?: string }, actor: Actor) => {
  const o = await Order.findOne({ code: code.toUpperCase(), eventId }).lean<OrderDoc>();
  if (!o) throw notFound('Order');
  if (o.status !== 'paid' && o.status !== 'partially refunded') throw conflict(`This order is ${o.status} and can’t be refunded`);
  const valid = await Ticket.find({ orderId: o._id, status: 'valid' }).lean<TicketDoc[]>();
  const used = await Ticket.countDocuments({ orderId: o._id, status: 'used' });
  let pick = valid;
  if (b.ticketIds?.length) {
    const want = new Set(b.ticketIds);
    pick = valid.filter((t) => want.has(String(t._id)));
    if (pick.length !== want.size) throw badRequest('Some of those tickets are not valid tickets on this order');
  }
  if (!pick.length) throw conflict(used ? 'These tickets have been used at the gate and can’t be refunded' : 'There is nothing left to refund on this order');
  const remaining = o.totalCents - o.refundedCents;
  const pickAdmits = pick.reduce((n, t) => n + t.admits, 0), validAdmits = valid.reduce((n, t) => n + t.admits, 0);
  const full = pickAdmits === validAdmits && !used;
  const amount = full ? remaining : Math.round((o.totalCents * pickAdmits) / o.admits / 100) * 100;
  const payments = await Payment.find({ orderId: o._id, status: 'success' });
  if (!full && payments.length > 1) throw conflict('A split order can only be refunded in full');

  await tx(async (session) => {
    const voided = await voidTicketsIn(o._id, pick.map((t) => t._id), 'refunded', session);
    if (voided.modifiedCount !== pick.length) throw conflict('The tickets changed while refunding. Try again.');
    await Order.updateOne({ _id: o._id }, { $inc: { refundedCents: amount }, $set: { status: full ? 'refunded' : 'partially refunded' } }, { session });
    await Event.updateOne({ _id: o.eventId }, { $inc: { 'stats.refundsCents': amount, 'stats.refundedOrders': full ? 1 : 0 } }, { session });
    await RefundRequest.updateMany({ orderId: o._id, status: { $in: ['requested', 'approved'] } }, { $set: { status: 'paid', amountCents: amount, decidedAt: new Date() } }, { session });
  });

  /* Money moves after the tickets are void. A provider failure is flagged for a manual refund, never lost. */
  const results = [];
  let left = amount;
  for (const p of payments) {
    const part = full ? p.amountCents - (p.refundAmountCents ?? 0) : Math.min(left, p.amountCents);
    if (part <= 0) continue;
    results.push(await refundPaymentRecord(p, b.reason || 'Refund approved by the organizer', part));
    left -= part;
  }
  const failed = results.filter((r) => !r.ok);
  const ev = await Event.findById(o.eventId, { name: 1 }).lean<{ name: string }>();
  const m = templates.refund({ event: ev?.name ?? '', amountCents: amount, code: o.code });
  await sendEmail({ to: o.buyer.email, subject: m.subject, text: m.text, tag: 'refund' });
  await audit(actor, 'Refunded order', o.code, { eventId: o.eventId, result: failed.length ? 'Needs manual refund' : full ? 'Refunded' : 'Partially refunded', after: { amountCents: amount, tickets: pick.length } });
  return { code: o.code, amountCents: amount, status: full ? 'refunded' : 'partially refunded', providerFailures: failed.map((f) => f.error) };
};

/** Resend the ticket email with the PDF attached. */
export const sendTicketEmail = async (orderId: Types.ObjectId | string, force = false) => {
  const o = force ? await Order.findById(orderId).lean<OrderDoc>() : await Order.findOneAndUpdate({ _id: orderId, notifiedAt: null, status: 'paid' }, { $set: { notifiedAt: new Date() } }, { new: true }).lean<OrderDoc>();
  if (!o || o.status !== 'paid') return false;
  const e = await Event.findById(o.eventId).lean<EventDoc>();
  const ts = await Ticket.find({ orderId: o._id, status: 'valid' }).lean<TicketDoc[]>();
  if (!e || !ts.length) return false;
  const m = templates.ticket({ name: o.buyer.name, event: e.name, startsAt: e.startsAt, gatesAt: e.gatesAt, venue: `${e.venueName}, ${e.city}`, line: o.line, code: o.code, totalCents: o.totalCents, viewUrl: web(`confirmation.html?order=${o.code}&t=${emailViewToken(o._id)}`) });
  const attachments = [];
  for (const t of ts.slice(0, 10)) attachments.push({ filename: `${o.code}-${String(t._id).slice(-4)}.pdf`, content: await ticketPdfFor(t), contentType: 'application/pdf' });
  await sendEmail({ to: o.buyer.email, subject: m.subject, text: m.text, attachments, tag: 'ticket' });
  if (o.buyer.mobile) await sendSms({ to: o.buyer.mobile, body: m.sms, tag: 'ticket' });
  return true;
};

export const resendTickets = async (eventId: string, code: string, actor: Actor) => {
  const o = await Order.findOne({ code: code.toUpperCase(), eventId }, { _id: 1, status: 1 }).lean<OrderDoc>();
  if (!o) throw notFound('Order');
  if (o.status !== 'paid') throw new AppError(409, 'NOT_PAID', 'Tickets are only sent for paid orders');
  const sent = await sendTicketEmail(o._id, true);
  await audit(actor, 'Resent tickets', code, { eventId });
  if (!sent) log.warn('resend found no valid tickets', { code });
  return { sent };
};

export const PARTY_OVER = RULES.partyPassOver;
export { Types };
