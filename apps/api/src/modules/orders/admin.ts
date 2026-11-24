/* Organizer: orders and attendees, CSV export, refund requests. Every query filters by the scoped eventId. */
import { RULES } from '@void/shared';
import { Order, RefundRequest, type OrderDoc } from '../../db/models/index.js';
import { toCsv, rupeesCell } from '../../lib/csv.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../lib/platform.js';
import { refundOrder } from './service.js';

const LABEL: Record<string, string> = { paid: 'Paid', 'split pending': 'Split pending', refunded: 'Refunded', 'partially refunded': 'Partially refunded', pending: 'Pending', cancelled: 'Cancelled' };
const PAY: Record<string, string> = { card: 'Card', koko: 'Koko', split: 'Split', cash: 'Box office', comp: 'Comp' };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const row = (o: OrderDoc) => ({
  code: o.code, who: o.buyer.name, email: o.buyer.email, item: o.line, qty: o.qty, partyPass: o.qty > RULES.partyPassOver || o.lines[0]?.kind === 'table',
  amountCents: o.totalCents, refundedCents: o.refundedCents, status: o.status, statusLabel: LABEL[o.status] ?? o.status, payMethod: o.payMethod, payLabel: PAY[o.payMethod] ?? o.payMethod, createdAt: o.createdAt,
});

export const listOrders = async (eventId: string, q: { q?: string; status?: string; page: number; limit: number; sort?: string }) => {
  const f: Record<string, unknown> = { eventId, status: { $ne: 'cancelled' } };
  if (q.status) { const want = Object.entries(LABEL).find(([, v]) => v.toLowerCase() === q.status!.toLowerCase())?.[0] ?? q.status.toLowerCase(); f.status = want; }
  if (q.q) { const r = new RegExp(esc(q.q), 'i'); f.$or = [{ code: r }, { 'buyer.name': r }, { 'buyer.email': r }, { line: r }]; }
  const [items, total, all] = await Promise.all([
    Order.find(f).sort(q.sort === 'amount' ? { totalCents: -1 } : { createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean<OrderDoc[]>(),
    Order.countDocuments(f), Order.countDocuments({ eventId, status: { $ne: 'cancelled' } }),
  ]);
  return { items: items.map(row), total, page: q.page, limit: q.limit, showing: `Showing ${items.length} of ${all}` };
};

export const ordersCsv = async (eventId: string) => {
  const os = await Order.find({ eventId, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).lean<OrderDoc[]>();
  return toCsv(os.map(row), [
    { key: 'code', label: 'Order' }, { key: 'who', label: 'Attendee' }, { key: 'email', label: 'Email' }, { key: 'item', label: 'Item' }, { key: 'qty', label: 'Qty' },
    { key: (r) => rupeesCell(r.amountCents), label: 'Amount (LKR)' }, { key: 'statusLabel', label: 'Status' }, { key: 'payLabel', label: 'Payment' }, { key: 'createdAt', label: 'Created (UTC)' },
  ]);
};

export const listRefundRequests = async (eventId: string, status?: string) => {
  const rs = await RefundRequest.find({ eventId, ...(status ? { status } : {}) }).sort({ createdAt: -1 }).lean();
  const codes = new Map((await Order.find({ _id: { $in: rs.map((r) => r.orderId) } }, { code: 1, totalCents: 1, buyer: 1 }).lean<OrderDoc[]>()).map((o) => [String(o._id), o]));
  return rs.map((r) => { const o = codes.get(String(r.orderId)); return { id: String(r._id), orderCode: o?.code ?? '', who: o?.buyer.name ?? '', amountCents: o?.totalCents ?? 0, reason: r.reason, status: r.status, createdAt: r.createdAt, note: r.note ?? null }; });
};

export const decideRefund = async (eventId: string, b: { id: string; decision: 'approved' | 'rejected'; note?: string }, actor: Actor) => {
  const r = await RefundRequest.findOne({ _id: b.id, eventId });
  if (!r) throw notFound('Refund request');
  if (r.status !== 'requested') throw conflict(`This request is already ${r.status}`);
  const o = await Order.findById(r.orderId, { code: 1 }).lean<OrderDoc>();
  if (b.decision === 'rejected') {
    r.status = 'rejected'; r.note = b.note; r.decidedAt = new Date(); r.decidedBy = actor.id as never; await r.save();
    await audit(actor, 'Rejected refund request', o?.code ?? '', { eventId, result: 'Rejected', after: { note: b.note } });
    return { id: b.id, status: 'rejected' };
  }
  r.status = 'approved'; r.decidedAt = new Date(); r.decidedBy = actor.id as never; r.note = b.note; await r.save();
  const out = await refundOrder(eventId, o!.code, { ticketIds: r.ticketIds.length ? r.ticketIds.map(String) : undefined, reason: b.note || r.reason }, actor);
  return { id: b.id, status: 'paid', refund: out };
};
