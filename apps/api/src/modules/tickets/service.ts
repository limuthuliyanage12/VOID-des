/*
 * Tickets issue only when the order (or the whole split group) is paid.
 * Up to 3 GA tickets get one QR each; more than 3 become one party pass that admits the whole party. A table is one party pass.
 * Transfers re-issue the ticket in the new holder's name; the old QR then fails at the gate.
 */
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { RULES, type TicketView } from '@void/shared';
import { env } from '../../config/env.js';
import { Event, Order, Ticket, Transfer, type OrderDoc, type TicketDoc } from '../../db/models/index.js';
import { derivedToken, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, conflict, forbidden, gone, notFound } from '../../lib/errors.js';
import { sendEmail, templates } from '../../lib/notify.js';
import { ticketPdf } from '../../lib/pdf.js';
import { audit } from '../../lib/platform.js';
import { ensureEventKey, tokenForTicket } from '../../lib/qr.js';
import type { AccessClaims } from '../../lib/tokens.js';

const tierName = (label: string) => label.replace(/^\d+\s*×\s*/, '');

export const issueTicketsIn = async (o: OrderDoc, session: ClientSession) => {
  if (o.ticketsIssuedAt || (await Ticket.exists({ orderId: o._id }).session(session))) return;
  const key = await ensureEventKey(o.eventId, session);
  const line = o.lines[0];
  const base = { orderId: o._id, orderCode: o.code, eventId: o.eventId, holderName: o.buyer.name, holderEmail: o.buyer.email, holderUserId: o.userId ?? null, keyVersion: key.version, status: 'valid' as const };
  const docs: Partial<TicketDoc>[] = [];
  if (line.kind === 'table') docs.push({ ...base, kind: 'table', admits: o.admits, line: `${o.line} · Party pass` });
  else if (o.qty > RULES.partyPassOver) docs.push({ ...base, kind: 'party', admits: o.qty, line: `${o.qty} × ${tierName(o.line)} · Party pass` });
  else for (let i = 0; i < o.qty; i++) docs.push({ ...base, kind: 'ga', admits: 1, line: `1 × ${tierName(o.line)}` });
  await Ticket.create(docs, { session, ordered: true });
  await Order.updateOne({ _id: o._id }, { $set: { ticketsIssuedAt: new Date() } }, { session });
};

type EventLite = { _id: Types.ObjectId; name: string; startsAt: Date; gatesAt: Date; endsAt: Date; venueName: string; city: string; art: string };

export const ticketView = async (t: TicketDoc, e: EventLite, withQr = true): Promise<TicketView> => ({
  id: String(t._id), orderCode: t.orderCode, kind: t.kind, admits: t.admits, status: t.status, holderName: t.holderName, line: t.line,
  event: { id: String(e._id), name: e.name, startsAt: e.startsAt.toISOString(), gatesAt: e.gatesAt.toISOString(), venue: e.venueName, city: e.city, art: e.art },
  qr: withQr && t.status === 'valid' ? await tokenForTicket(t as never) : null,
});

const EVENT_FIELDS = { name: 1, startsAt: 1, gatesAt: 1, endsAt: 1, venueName: 1, city: 1, art: 1 };

export const myTickets = async (a: AccessClaims) => {
  const ts = await Ticket.find({ $or: [{ holderUserId: a.sub }, { holderEmail: a.email }] }).sort({ createdAt: -1 }).lean<TicketDoc[]>();
  const events = new Map((await Event.find({ _id: { $in: [...new Set(ts.map((t) => String(t.eventId)))] } }, EVENT_FIELDS).lean<EventLite[]>()).map((e) => [String(e._id), e]));
  const now = Date.now(), upcoming: TicketView[] = [], past: TicketView[] = [];
  for (const t of ts) {
    const e = events.get(String(t.eventId)); if (!e) continue;
    const v = await ticketView(t, e);
    (e.endsAt.getTime() >= now ? upcoming : past).push(v);
  }
  return { upcoming, past };
};

/** The holder, the buyer (with the order's view token), an organizer of the event or the super admin may open a ticket. */
export const loadTicketFor = async (id: string, a: AccessClaims | undefined, viewToken?: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Ticket');
  const t = await Ticket.findById(id).lean<TicketDoc>();
  if (!t) throw notFound('Ticket');
  const ok = (a && (String(t.holderUserId) === a.sub || t.holderEmail === a.email || a.role === 'super' || (a.role === 'organizer' && a.eid === String(t.eventId))))
    || (viewToken && checkViewToken(await Order.findById(t.orderId, { viewTokenHash: 1 }).lean<{ _id: Types.ObjectId; viewTokenHash?: string | null }>(), viewToken));
  if (!ok) throw notFound('Ticket');
  return t;
};

export const ticketPdfFor = async (t: TicketDoc) => {
  const e = await Event.findById(t.eventId).lean<EventLite>();
  const o = await Order.findById(t.orderId, { totalCents: 1 }).lean<{ totalCents: number }>();
  if (!e) throw notFound('Event');
  if (t.status !== 'valid' && t.status !== 'used') throw gone('This ticket is no longer valid');
  return ticketPdf({ eventName: e.name, venue: e.venueName, city: e.city, startsAt: e.startsAt, gatesAt: e.gatesAt, holderName: t.holderName, line: t.line, admits: t.admits, orderCode: t.orderCode, amountCents: o?.totalCents ?? 0, kind: t.kind, token: await tokenForTicket(t as never) });
};

/* ---------- Transfers to a named holder, up to gate time ---------- */
export const startTransfer = async (id: string, a: AccessClaims, b: { toName: string; toEmail: string }) => {
  const t = await Ticket.findById(id);
  if (!t || (String(t.holderUserId) !== a.sub && t.holderEmail !== a.email)) throw notFound('Ticket');
  if (t.status !== 'valid') throw conflict('Only a valid ticket can be transferred');
  if (b.toEmail === t.holderEmail) throw conflict('That is already the ticket holder');
  const e = await Event.findById(t.eventId, { name: 1, gatesAt: 1 }).lean<{ name: string; gatesAt: Date }>();
  if (!e || e.gatesAt.getTime() <= Date.now()) throw conflict('Transfers close when the gates open');
  await Transfer.updateMany({ ticketId: t._id, status: 'sent' }, { $set: { status: 'cancelled' } });
  const token = randomToken(24);
  await Transfer.create({ ticketId: t._id, fromUserId: a.sub, fromEmail: a.email, toName: b.toName, toEmail: b.toEmail, tokenHash: sha256(token), expiresAt: e.gatesAt });
  const link = `${env.webOrigin}/tickets.html?transfer=${token}`;
  const m = templates.transfer({ from: t.holderName, to: b.toName, event: e.name, link });
  await sendEmail({ to: b.toEmail, subject: m.subject, text: m.text, tag: 'transfer' });
  await audit({ id: a.sub, label: a.name }, 'Sent ticket transfer', `${t.orderCode} → ${b.toEmail}`, { eventId: t.eventId });
  return { status: 'sent', toName: b.toName, toEmail: b.toEmail, ...(env.demoMode ? { demoLink: link } : {}) };
};

export const acceptTransfer = async (token: string, a: AccessClaims | undefined) => {
  const tr = await Transfer.findOne({ tokenHash: sha256(token) });
  if (!tr || tr.status !== 'sent' || tr.expiresAt.getTime() < Date.now()) throw new AppError(410, 'TRANSFER_INVALID', 'This transfer link has expired or was already used');
  if (a && a.email !== tr.toEmail) throw forbidden('Sign in with the email the ticket was sent to');
  const old = await Ticket.findOneAndUpdate({ _id: tr.ticketId, status: 'valid' }, { $set: { status: 'transferred' } }, { new: true });
  if (!old) { await Transfer.updateOne({ _id: tr._id }, { $set: { status: 'cancelled' } }); throw conflict('This ticket can no longer be transferred'); }
  const fresh = await Ticket.create({
    orderId: old.orderId, orderCode: old.orderCode, eventId: old.eventId, holderName: tr.toName, holderEmail: tr.toEmail, holderUserId: a?.sub ?? null,
    kind: old.kind, admits: old.admits, line: old.line, keyVersion: old.keyVersion, qrSecretVersion: (old.qrSecretVersion ?? 1) + 1, status: 'valid',
  });
  await Transfer.updateOne({ _id: tr._id }, { $set: { status: 'accepted', acceptedAt: new Date() } });
  await audit({ id: a?.sub ?? null, label: tr.toName }, 'Accepted ticket transfer', old.orderCode, { eventId: old.eventId });
  return { ticketId: String(fresh._id), holderName: fresh.holderName };
};

/** Voids tickets so they fail at the gate. Used by refunds and chargebacks. */
export const voidTicketsIn = async (orderId: Types.ObjectId, ids: Types.ObjectId[] | null, reason: string, session: ClientSession) =>
  Ticket.updateMany({ orderId, status: 'valid', ...(ids ? { _id: { $in: ids } } : {}) }, { $set: { status: 'void', voidReason: reason } }, { session });

/** The checkout's view token (stored hashed) or the email link's derived token both open an order. */
export const checkViewToken = (o: { _id: Types.ObjectId; viewTokenHash?: string | null } | null, token: string | undefined): boolean =>
  !!o && !!token && ((!!o.viewTokenHash && safeEqual(o.viewTokenHash, sha256(token))) || safeEqual(derivedToken('order', String(o._id)), token));
export const emailViewToken = (orderId: Types.ObjectId | string) => derivedToken('order', String(orderId));
