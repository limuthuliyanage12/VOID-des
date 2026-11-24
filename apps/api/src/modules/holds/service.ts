/*
 * Holds. Selecting tickets or a table holds them for 10 minutes (settings.seatHoldMinutes).
 * The reservation and the hold insert share one transaction, so either both happen or neither does.
 * Expiry is a delayed job at expiresAt; the minute sweep and the TTL index are backstops.
 */
import { Types, type ClientSession } from 'mongoose';
import { RULES, VIP, type HoldBody, type HoldView } from '@void/shared';
import { tx } from '../../db/connect.js';
import { Event, Hold, Order, PresaleCode, Table, Tier, type EventDoc, type HoldDoc } from '../../db/models/index.js';
import { randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, gone, locked, notFound } from '../../lib/errors.js';
import { jobs } from '../../lib/jobs.js';
import { getSettings } from '../../lib/platform.js';
import { emit } from '../../lib/realtime.js';
import { resolveEvent } from '../../middleware/scope.js';
import { liveTableCodes } from '../layouts/service.js';
import { freeTable, holdTable, leftOf, releasePresale, releaseTier, reservePresale, reserveTier } from '../tiers/inventory.js';

export const assertBookable = (e: Pick<EventDoc, 'status'>) => {
  if (e.status === 'suspended') throw locked('Sales are paused');
  if (e.status === 'sold out') throw conflict('This event is sold out', undefined, 'SOLD_OUT');
  if (e.status !== 'live') throw conflict('Tickets for this event are not on sale', undefined, 'NOT_ON_SALE');
};

const holdView = (h: HoldDoc, secret?: string): HoldView => ({
  id: String(h._id), ...(secret ? { secret } : {}), kind: h.kind, qty: h.qty, unitCents: h.unitCents, label: h.label,
  expiresAt: h.expiresAt.toISOString(),
  /* The screen counts down from 9 min 41 s; the server keeps the seats for the full 10 minutes. */
  displayExpiresAt: new Date(h.createdAt ? new Date(h.createdAt as Date).getTime() + RULES.holdDisplayMs : h.expiresAt.getTime()).toISOString(),
});

export const emitInventory = async (eventId: Types.ObjectId | string) => {
  const tiers = await Tier.find({ eventId }, { name: 1, total: 1, sold: 1, held: 1, state: 1 }).lean();
  const tables = await Table.find({ eventId }, { code: 1, status: 1 }).lean();
  emit(`event.${eventId}`, 'inventory', { tiers: tiers.map((t) => ({ id: String(t._id), left: leftOf(t), state: t.state })), tables: tables.map((t) => ({ code: t.code, status: t.status })) });
};

export const createHold = async (b: HoldBody, who: { userId?: string | null }) => {
  const event = await resolveEvent(b.eventId);
  if (!event) throw notFound('Event');
  assertBookable(event);
  const settings = await getSettings();
  const secret = randomToken(24);
  const expiresAt = new Date(Date.now() + settings.seatHoldMinutes * 60_000);
  const holdId = new Types.ObjectId();

  const hold = await tx(async (session) => {
    const ev = await Event.findById(event._id, { status: 1 }, { session });
    if (!ev) throw notFound('Event');
    assertBookable(ev);
    const base = { _id: holdId, eventId: event._id, userId: who.userId ?? null, guestEmail: b.guestEmail ?? null, secretHash: sha256(secret), expiresAt, status: 'active' as const };

    if (b.kind === 'tier') {
      const tier = await Tier.findOne({ _id: b.tierId, eventId: event._id }, null, { session });
      if (!tier) throw notFound('Ticket tier');
      if (tier.state !== 'on sale') throw conflict(`${tier.name} is not on sale`, { state: tier.state }, 'TIER_CLOSED');
      let unitCents = tier.priceCents, label = `${b.qty} × ${tier.name}`, presaleCodeId: Types.ObjectId | null = null;
      if (b.presaleCode) {
        const code = await PresaleCode.findOne({ eventId: event._id, code: b.presaleCode.toUpperCase(), active: true }, null, { session });
        if (!code) throw badRequest('That code isn’t valid for this event', { field: 'presaleCode' });
        if (!(await reservePresale(code._id, b.qty, session))) throw conflict('This presale code has been used up', { left: Math.max(0, code.limit - code.used - code.held) }, 'PRESALE_USED_UP');
        unitCents = code.priceCents; label = `${b.qty} × Presale`; presaleCodeId = code._id;
      }
      const ok = await reserveTier(tier._id, b.qty, session);
      if (!ok) {
        const fresh = await Tier.findById(tier._id, null, { session });
        const left = fresh ? leftOf(fresh) : 0;
        throw conflict(left ? `Only ${left} left in ${tier.name}` : `${tier.name} has just sold out`, { left }, 'NOT_ENOUGH_LEFT');
      }
      const [h] = await Hold.create([{ ...base, kind: 'tier', tierId: tier._id, qty: b.qty, unitCents, label, presaleCodeId }], { session });
      return h;
    }

    /* Table hold. Only from the approved layout, and only for the tier the buyer chose. */
    if (!event.hasVip) throw notFound('VIP tables for this event');
    const table = await Table.findOne({ eventId: event._id, code: b.tableCode }, null, { session });
    if (!table || !(await liveTableCodes(event._id, session)).includes(table.code)) throw notFound('That table');
    if (table.tier !== b.vipTier) throw forbidden(`${table.code} is a ${VIP[table.tier].name} table. Choose the ${VIP[table.tier].name} tier to book it.`);
    if (!(await holdTable(table._id, holdId, session))) throw conflict(`${table.code} has just been taken`, { status: table.status }, 'TABLE_TAKEN');
    const [h] = await Hold.create([{ ...base, kind: 'table', tableId: table._id, tableCode: table.code, qty: 1, unitCents: table.minSpendCents, label: `Table ${table.code} · ${VIP[table.tier].name}` }], { session });
    return h;
  });

  await jobs.at('expireHold', expiresAt, { holdId: String(hold._id) }, `hold-${hold._id}`);
  void emitInventory(event._id);
  return holdView(hold.toObject() as HoldDoc, secret);
};

export const getHoldForBuyer = async (holdId: string, secret: string) => {
  const h = await Hold.findById(holdId);
  if (!h || !safeEqual(h.secretHash, sha256(secret))) throw notFound('That hold');
  return h;
};

/**
 * Gives a hold's seats or table back and cancels its unpaid order. Safe to run twice: only an active hold moves.
 * Pass a session to join a larger transaction.
 */
export const releaseHoldIn = async (holdId: Types.ObjectId | string, reason: 'expired' | 'released', session: ClientSession) => {
  const h = await Hold.findOneAndUpdate({ _id: holdId, status: 'active' }, { $set: { status: reason, releasedReason: reason } }, { new: true, session });
  if (!h) return null;
  if (h.kind === 'tier' && h.tierId) await releaseTier(h.tierId, h.qty, session);
  if (h.presaleCodeId) await releasePresale(h.presaleCodeId, h.qty, session);
  if (h.kind === 'table' && h.tableId) await freeTable(h.tableId, session, h._id);
  if (h.orderId) await Order.updateOne({ _id: h.orderId, status: 'pending' }, { $set: { status: 'cancelled', cancelledAt: new Date() } }, { session });
  return h;
};

export const releaseHold = async (holdId: string, reason: 'expired' | 'released') => {
  const h = await tx((s) => releaseHoldIn(holdId, reason, s));
  if (h) { await jobs.remove(`hold-${holdId}`); void emitInventory(h.eventId); }
  return h;
};

/** DELETE /holds/{id}: the buyer lets go early. Only a hold with no payment under way can go. */
export const releaseByBuyer = async (holdId: string, secret: string) => {
  const h = await getHoldForBuyer(holdId, secret);
  if (h.status !== 'active') throw gone('This hold has already ended');
  if (h.orderId && (await Order.exists({ _id: h.orderId, status: { $ne: 'pending' } }))) throw new AppError(409, 'PAYMENT_UNDER_WAY', 'A payment is already under way for this hold');
  await releaseHold(holdId, 'released');
};

/** The expireHold job. A hold extended for split pay has a later expiresAt and is left alone. */
export const expireHold = async ({ holdId }: { holdId: string }) => {
  const h = await Hold.findById(holdId, { status: 1, expiresAt: 1 }).lean();
  if (!h || h.status !== 'active' || h.expiresAt.getTime() > Date.now() + 1000) return;
  await releaseHold(holdId, 'expired');
};

/** The sweep: any active hold past its time, in case a timer was lost in a restart. */
export const sweepHolds = async () => {
  const due = await Hold.find({ status: 'active', expiresAt: { $lte: new Date() } }, { _id: 1 }).limit(500).lean();
  for (const h of due) await releaseHold(String(h._id), 'expired');
  return due.length;
};
