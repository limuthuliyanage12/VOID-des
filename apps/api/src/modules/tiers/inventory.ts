/*
 * Inventory moves. Nothing here oversells: every move is one conditional update whose filter carries the rule.
 *   reserve:  sold + held + qty <= total      ($inc held)
 *   convert:  held -> sold                     ($inc sold, -held)
 *   release:  held -> free                     ($inc -held)
 * Tiers sell in order. When one sells out and auto-advance is on, the next opens in the same transaction.
 */
import type { ClientSession, Types } from 'mongoose';
import { Event, PresaleCode, Table, Tier } from '../../db/models/index.js';
import { audit, SYSTEM } from '../../lib/platform.js';

type Id = Types.ObjectId | string;

export const leftOf = (t: { total: number; sold: number; held: number }) => Math.max(0, t.total - t.sold - t.held);

export const reserveTier = (tierId: Id, qty: number, session: ClientSession, opts: { requireOnSale?: boolean } = {}) =>
  Tier.findOneAndUpdate(
    { _id: tierId, ...(opts.requireOnSale === false ? {} : { state: 'on sale' }), $expr: { $lte: [{ $add: ['$sold', '$held', qty] }, '$total'] } },
    { $inc: { held: qty } }, { new: true, session },
  );

export const reservePresale = (codeId: Id, qty: number, session: ClientSession) =>
  PresaleCode.findOneAndUpdate({ _id: codeId, active: true, $expr: { $lte: [{ $add: ['$used', '$held', qty] }, '$limit'] } }, { $inc: { held: qty } }, { new: true, session });

export const releaseTier = (tierId: Id, qty: number, session: ClientSession) =>
  Tier.updateOne({ _id: tierId, held: { $gte: qty } }, { $inc: { held: -qty } }, { session });

export const releasePresale = (codeId: Id, qty: number, session: ClientSession) =>
  PresaleCode.updateOne({ _id: codeId, held: { $gte: qty } }, { $inc: { held: -qty } }, { session });

/** Moves held seats to sold, then opens the next tier if this one is now full. */
export const convertTier = async (tierId: Id, qty: number, session: ClientSession) => {
  const t = await Tier.findOneAndUpdate({ _id: tierId, held: { $gte: qty } }, { $inc: { sold: qty, held: -qty } }, { new: true, session });
  if (!t) return null;
  await advanceIfFull(t._id, session);
  return t;
};

/** Sells seats that are no longer held (the hold lapsed while the buyer was paying). Only succeeds if there is room. */
export const sellWithoutHold = async (tierId: Id, qty: number, session: ClientSession) => {
  const t = await Tier.findOneAndUpdate({ _id: tierId, $expr: { $lte: [{ $add: ['$sold', '$held', qty] }, '$total'] } }, { $inc: { sold: qty } }, { new: true, session });
  if (t) await advanceIfFull(t._id, session);
  return t;
};

export const convertPresale = (codeId: Id, qty: number, session: ClientSession) =>
  PresaleCode.updateOne({ _id: codeId, held: { $gte: qty } }, { $inc: { used: qty, held: -qty } }, { session });

export const advanceIfFull = async (tierId: Id, session: ClientSession) => {
  const t = await Tier.findById(tierId, null, { session });
  if (!t || t.state !== 'on sale' || t.sold < t.total) return null;
  await Tier.updateOne({ _id: t._id, state: 'on sale' }, { $set: { state: 'sold out' } }, { session });
  const event = await Event.findById(t.eventId, { name: 1, status: 1 }, { session });
  if (!t.autoAdvance) return null;
  const next = await Tier.findOne({ eventId: t.eventId, order: { $gt: t.order }, state: { $in: ['up next', 'scheduled'] } }, null, { session }).sort({ order: 1 });
  if (!next) {
    const anyLeft = await Tier.exists({ eventId: t.eventId, state: { $in: ['on sale', 'up next', 'scheduled'] } }).session(session);
    if (!anyLeft && event?.status === 'live') await Event.updateOne({ _id: t.eventId, status: 'live' }, { $set: { status: 'sold out' } }, { session });
    return null;
  }
  await Tier.updateOne({ _id: next._id }, { $set: { state: 'on sale', 'window.startsAt': new Date() } }, { session });
  const after = await Tier.findOne({ eventId: t.eventId, order: { $gt: next.order }, state: 'scheduled' }, null, { session }).sort({ order: 1 });
  if (after) await Tier.updateOne({ _id: after._id }, { $set: { state: 'up next' } }, { session });
  await audit(SYSTEM, 'Opened tier', `${event?.name ?? 'Event'} · ${next.name}`, { result: 'On sale', eventId: t.eventId, session });
  return next;
};

/* ---------- Tables: available -> held -> reserved ---------- */
export const holdTable = (tableId: Id, holdId: Id, session: ClientSession) =>
  Table.findOneAndUpdate({ _id: tableId, status: 'available' }, { $set: { status: 'held', holdId } }, { new: true, session });
export const reserveHeldTable = (tableId: Id, holdId: Id, session: ClientSession) =>
  Table.findOneAndUpdate({ _id: tableId, status: 'held', holdId }, { $set: { status: 'reserved' } }, { new: true, session });
export const reserveFreeTable = (tableId: Id, session: ClientSession) =>
  Table.findOneAndUpdate({ _id: tableId, status: 'available' }, { $set: { status: 'reserved', holdId: null } }, { new: true, session });
export const freeTable = (tableId: Id, session: ClientSession, holdId?: Id) =>
  Table.updateOne({ _id: tableId, ...(holdId ? { holdId, status: 'held' } : {}) }, { $set: { status: 'available', holdId: null } }, { session });
