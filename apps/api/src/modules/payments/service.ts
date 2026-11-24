/*
 * Provider callbacks. Each one is verified, stored raw, and de-duplicated by (provider, providerPaymentId).
 * The route answers 200 at once and the completePayment job does the work. That job is safe to run twice.
 */
import type { Types } from 'mongoose';
import { tx } from '../../db/connect.js';
import { KokoPlan, Order, Payment, SplitShare, type OrderDoc, type PaymentDoc } from '../../db/models/index.js';
import { isDupKey } from '../../lib/errors.js';
import { jobs } from '../../lib/jobs.js';
import { koko } from '../../lib/koko.js';
import { log } from '../../lib/log.js';
import { refundPayment, STATUS_MAP, verifyNotify, type NotifyBody } from '../../lib/payhere.js';
import { audit, SYSTEM } from '../../lib/platform.js';
import { emitInventory } from '../holds/service.js';
import { fulfilIn } from '../orders/fulfil.js';
import { voidTicketsIn } from '../tickets/service.js';

type Status = 'success' | 'pending' | 'cancelled' | 'failed' | 'charged back';
const ORDER_ID_RE = /^(VOID-\d{7})(?:-S(\d))?$/;

interface Incoming { provider: 'payhere' | 'koko'; providerPaymentId: string; providerOrderId: string; orderId: Types.ObjectId; splitShareId: Types.ObjectId | null; amountCents: number; status: Status; method?: string | null; raw: unknown }

/** Insert the payment, or move an existing one to a new status. A callback repeating the same status is ignored. */
export const recordPayment = async (p: Incoming): Promise<{ repeat: boolean; payment: PaymentDoc | null; changed: boolean }> => {
  const entry = { status: p.status, at: new Date(), raw: p.raw };
  try {
    const created = await Payment.create({ ...p, verifiedAt: new Date(), history: [entry] });
    return { repeat: false, changed: true, payment: created.toObject() as PaymentDoc };
  } catch (e) {
    if (!isDupKey(e)) throw e;
  }
  const existing = await Payment.findOne({ provider: p.provider, providerPaymentId: p.providerPaymentId }).lean<PaymentDoc>();
  if (!existing || existing.status === p.status) return { repeat: true, changed: false, payment: existing };
  /* A late "pending" never overwrites a final status. */
  if (p.status === 'pending' || existing.status === 'refunded') return { repeat: true, changed: false, payment: existing };
  const moved = await Payment.findOneAndUpdate({ _id: existing._id, status: existing.status }, { $set: { status: p.status, raw: p.raw }, $push: { history: entry } }, { new: true }).lean<PaymentDoc>();
  return { repeat: !moved, changed: !!moved, payment: moved ?? existing };
};

const target = async (providerOrderId: string) => {
  const m = ORDER_ID_RE.exec(providerOrderId);
  if (!m) return null;
  const order = await Order.findOne({ code: m[1] }).lean<OrderDoc>();
  if (!order) return null;
  const share = m[2] != null ? await SplitShare.findOne({ orderId: order._id, index: Number(m[2]) }).lean() : null;
  if (m[2] != null && !share) return null;
  return { order, share };
};

export const handlePayhereNotify = async (b: Partial<NotifyBody>): Promise<{ httpStatus: number; result: string }> => {
  if (!verifyNotify(b)) { log.warn('payhere notify rejected: bad signature', { order_id: b.order_id }); return { httpStatus: 400, result: 'bad signature' }; }
  if (b.payhere_currency !== 'LKR') return { httpStatus: 400, result: 'wrong currency' };
  const t = await target(String(b.order_id));
  if (!t) { log.warn('payhere notify for unknown order', { order_id: b.order_id }); return { httpStatus: 200, result: 'unknown order' }; }
  const status = STATUS_MAP[String(b.status_code)] ?? 'failed';
  const rec = await recordPayment({
    provider: 'payhere', providerPaymentId: String(b.payment_id), providerOrderId: String(b.order_id), orderId: t.order._id, splitShareId: t.share?._id ?? null,
    amountCents: Math.round(Number(b.payhere_amount) * 100), status, method: b.method ?? null, raw: b,
  });
  if (rec.repeat || !rec.payment) return { httpStatus: 200, result: 'repeat ignored' };
  if (status === 'success') await jobs.add('completePayment', { paymentId: String(rec.payment._id) });
  if (status === 'charged back') await jobs.add('chargeback', { paymentId: String(rec.payment._id) });
  return { httpStatus: 200, result: status };
};

export const handleKokoCallback = async (raw: string, signature: string, body: Record<string, unknown>): Promise<{ httpStatus: number; result: string }> => {
  const k = koko();
  if (!k.verifyCallback(raw, signature)) { log.warn('koko callback rejected: bad signature'); return { httpStatus: 400, result: 'bad signature' }; }
  const cb = k.parseCallback(body);
  const t = await target(cb.orderId);
  if (!t) return { httpStatus: 200, result: 'unknown order' };
  if (cb.status === 'declined') { await KokoPlan.updateOne({ orderId: t.order._id, status: 'pending approval' }, { $set: { status: 'failed' } }); }
  const status: Status = cb.status === 'approved' ? 'success' : cb.status === 'pending' ? 'pending' : 'failed';
  const rec = await recordPayment({ provider: 'koko', providerPaymentId: cb.paymentId || cb.kokoRef, providerOrderId: cb.orderId, orderId: t.order._id, splitShareId: null, amountCents: cb.amountCents, status, method: 'KOKO', raw: body });
  if (rec.repeat || !rec.payment) return { httpStatus: 200, result: 'repeat ignored' };
  if (status === 'success') await jobs.add('completePayment', { paymentId: String(rec.payment._id) });
  return { httpStatus: 200, result: status };
};

/** The order completion job. Marks the payment, moves the order or share to paid, converts holds, issues tickets. */
export const completePayment = async ({ paymentId }: { paymentId: string }) => {
  const p = await Payment.findById(paymentId).lean<PaymentDoc>();
  if (!p || p.status !== 'success' || p.processedAt) return;
  const order = await Order.findById(p.orderId).lean<OrderDoc>();
  if (!order) return;
  const share = p.splitShareId ? await SplitShare.findById(p.splitShareId).lean() : null;
  const expected = share ? share.amountCents : order.totalCents;
  if (p.amountCents !== expected) {
    await Payment.updateOne({ _id: p._id }, { $set: { needsAttention: `Amount ${p.amountCents} does not match ${expected}`, processedAt: new Date() } });
    await audit(SYSTEM, 'Payment amount mismatch', order.code, { result: 'Held for review', eventId: order.eventId, after: { got: p.amountCents, expected } });
    return;
  }
  if (share) {
    const { payShare } = await import('../split/service.js');
    await payShare(p);
  } else {
    const r = await tx((s) => fulfilIn(order._id, s));
    await Payment.updateOne({ _id: p._id, processedAt: null }, { $set: { processedAt: new Date() } });
    if (!r.ok) {
      log.warn('paid order could not be fulfilled', { code: order.code, reason: r.reason });
      await refundPaymentRecord(p, r.reason === 'no inventory' ? 'Sold out before your payment finished' : 'Order closed before payment finished');
      await audit(SYSTEM, 'Refunded late payment', order.code, { eventId: order.eventId, result: r.reason });
      return;
    }
    if (!r.already) await jobs.add('orderPaid', { orderId: String(order._id) });
  }
  await Payment.updateOne({ _id: p._id, processedAt: null }, { $set: { processedAt: new Date() } });
};

/** Refunds one payment through its provider. A failure is flagged for a manual refund and audited. */
export const refundPaymentRecord = async (p: PaymentDoc | { _id: Types.ObjectId; provider: string; providerPaymentId: string; amountCents: number; orderId: Types.ObjectId; splitShareId?: Types.ObjectId | null; refundAmountCents?: number }, reason: string, amountCents = p.amountCents - ((p as PaymentDoc).refundAmountCents ?? 0)) => {
  if (amountCents <= 0) return { ok: true, ref: '', simulated: true };
  let out: { ok: boolean; ref: string; error?: string; simulated?: boolean };
  if (p.provider === 'payhere') out = await refundPayment(p.providerPaymentId, reason);
  else if (p.provider === 'koko') out = await koko().refund(p.providerPaymentId, amountCents);
  else out = { ok: true, ref: `MANUAL-${p.providerPaymentId}`, simulated: true };
  const fullyRefunded = amountCents + ((p as PaymentDoc).refundAmountCents ?? 0) >= p.amountCents;
  if (out.ok) {
    await Payment.updateOne({ _id: p._id }, { $set: { refundedAt: new Date(), refundRef: out.ref, ...(fullyRefunded ? { status: 'refunded' } : {}) }, $inc: { refundAmountCents: amountCents }, $push: { history: { status: 'refunded', at: new Date(), raw: { ref: out.ref, amountCents } } } });
    if (p.splitShareId) await SplitShare.updateOne({ _id: p.splitShareId }, { $set: { status: 'refunded' } });
  } else {
    await Payment.updateOne({ _id: p._id }, { $set: { needsAttention: `Refund failed: ${out.error}` } });
    await audit(SYSTEM, 'Refund failed', p.providerPaymentId, { result: 'Needs manual refund', after: { error: out.error } });
  }
  return out;
};

/** A chargeback voids the order's tickets and flags the payment. */
export const chargeback = async ({ paymentId }: { paymentId: string }) => {
  const p = await Payment.findById(paymentId).lean<PaymentDoc>();
  if (!p) return;
  await tx(async (s) => {
    await voidTicketsIn(p.orderId, null, 'charged back', s);
    await Order.updateOne({ _id: p.orderId }, { $set: { status: 'refunded' }, $inc: { refundedCents: p.amountCents } }, { session: s });
    await Payment.updateOne({ _id: p._id }, { $set: { needsAttention: 'Charged back' } }, { session: s });
  });
  const o = await Order.findById(p.orderId, { code: 1, eventId: 1 }).lean<OrderDoc>();
  await audit(SYSTEM, 'Payment charged back', o?.code ?? String(p.orderId), { eventId: o?.eventId, result: 'Tickets void' });
  if (o) void emitInventory(o.eventId);
};
