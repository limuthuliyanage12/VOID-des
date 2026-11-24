/*
 * Turning a paid order into sold inventory and tickets. Runs inside the caller's transaction and is safe to run twice:
 * `counted` guards the counters and `ticketsIssuedAt` guards the tickets.
 */
import type { ClientSession, Types } from 'mongoose';
import { Campaign, Event, Hold, KokoPlan, Order, PresaleCode, Tier, type OrderDoc } from '../../db/models/index.js';
import { releaseHoldIn } from '../holds/service.js';
import { issueTicketsIn } from '../tickets/service.js';
import { convertPresale, convertTier, freeTable, reserveFreeTable, reserveHeldTable, sellWithoutHold } from '../tiers/inventory.js';

const isTierLine = (k: string) => k === 'tier' || k === 'presale' || k === 'box office' || k === 'comp';

/** Moves the order's seats or table to sold. Returns false if the hold had lapsed and there is no room left. */
const moveInventory = async (o: OrderDoc, session: ClientSession): Promise<boolean> => {
  const line = o.lines[0];
  const hold = o.holdId ? await Hold.findOneAndUpdate({ _id: o.holdId, status: 'active' }, { $set: { status: 'converted' } }, { new: true, session }) : null;
  if (isTierLine(line.kind) && line.tierId) {
    if (hold) {
      if (!(await convertTier(line.tierId, line.qty, session))) return false;
      if (line.presaleCodeId) await convertPresale(line.presaleCodeId, line.qty, session);
    } else {
      if (!(await sellWithoutHold(line.tierId, line.qty, session))) return false;
      if (line.presaleCodeId) await PresaleCode.updateOne({ _id: line.presaleCodeId }, { $inc: { used: line.qty } }, { session });
    }
    return true;
  }
  if (line.kind === 'table' && line.tableId) {
    return !!(hold ? await reserveHeldTable(line.tableId, hold._id, session) : await reserveFreeTable(line.tableId, session));
  }
  return false;
};

const counterInc = (o: OrderDoc, sign: 1 | -1) => {
  const line = o.lines[0];
  if (line.kind === 'comp') return null;
  const table = line.kind === 'table';
  return {
    'stats.sold': table ? 0 : sign * o.qty,
    'stats.orders': sign,
    'stats.grossCents': sign * o.subtotalCents,
    'stats.ticketGrossCents': table ? 0 : sign * o.subtotalCents,
    'stats.tableGrossCents': table ? sign * o.subtotalCents : 0,
    'stats.feesCents': sign * o.feeCents,
  };
};

export type FulfilResult = { ok: true; already?: boolean; orderId: Types.ObjectId } | { ok: false; reason: 'missing' | 'no inventory' | 'closed'; orderId?: Types.ObjectId };

export const fulfilIn = async (orderId: Types.ObjectId | string, session: ClientSession): Promise<FulfilResult> => {
  const o = await Order.findById(orderId, null, { session }).lean<OrderDoc>();
  if (!o) return { ok: false, reason: 'missing' };
  if (o.status === 'paid' && o.ticketsIssuedAt) return { ok: true, already: true, orderId: o._id };
  if (!['pending', 'cancelled', 'split pending', 'paid'].includes(o.status)) return { ok: false, reason: 'closed', orderId: o._id };
  if (!o.counted) {
    if (!(await moveInventory(o, session))) return { ok: false, reason: 'no inventory', orderId: o._id };
    const inc = counterInc(o, 1);
    if (inc) await Event.updateOne({ _id: o.eventId }, { $inc: inc }, { session });
    if (o.source) await Campaign.updateOne({ eventId: o.eventId, ref: o.source }, { $inc: { sales: o.qty, revenueCents: o.subtotalCents } }, { session });
  }
  await Order.updateOne({ _id: o._id }, { $set: { status: 'paid', paidAt: o.paidAt ?? new Date(), counted: true, cancelledAt: null } }, { session });
  await issueTicketsIn(o, session);
  await KokoPlan.updateOne({ orderId: o._id, status: 'pending approval' }, { $set: { status: 'active', received: 1 } }, { session });
  return { ok: true, orderId: o._id };
};

/**
 * Gives an unfinished order's inventory back: an active hold is released, and a sale that was already counted
 * (seeded split groups were counted as sold, the way the prototype counted them) is reversed.
 */
export const releaseOrderInventoryIn = async (o: OrderDoc, session: ClientSession) => {
  if (o.holdId && (await releaseHoldIn(o.holdId, 'released', session))) return;
  if (!o.counted) return;
  const line = o.lines[0];
  if (isTierLine(line.kind) && line.tierId) {
    await Tier.updateOne({ _id: line.tierId, sold: { $gte: line.qty } }, { $inc: { sold: -line.qty } }, { session });
    await Tier.updateOne({ _id: line.tierId, state: 'sold out', $expr: { $lt: ['$sold', '$total'] } }, { $set: { state: 'on sale' } }, { session });
  }
  if (line.kind === 'table' && line.tableId) await freeTable(line.tableId, session);
  const inc = counterInc(o, -1);
  if (inc) await Event.updateOne({ _id: o.eventId }, { $inc: inc }, { session });
  await Order.updateOne({ _id: o._id }, { $set: { counted: false } }, { session });
};
