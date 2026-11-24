/* Organizer: tiers, auto-advance, presale codes, comp tickets, waitlist. Every query carries the scoped eventId. */
import { Types } from 'mongoose';
import { RULES } from '@void/shared';
import { tx } from '../../db/connect.js';
import { Event, NotifyEntry, Order, PresaleCode, Tier, type TierDoc } from '../../db/models/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, isDupKey, notFound } from '../../lib/errors.js';
import { jobs } from '../../lib/jobs.js';
import { audit, nextOrderCode, type Actor } from '../../lib/platform.js';
import { emitInventory } from '../holds/service.js';
import { tierView } from '../events/service.js';
import { fulfilIn } from '../orders/fulfil.js';
import { Hold } from '../../db/models/index.js';
import { reserveTier } from './inventory.js';

export const listTiers = async (eventId: string) => {
  const ts = await Tier.find({ eventId }).sort({ order: 1 }).lean<TierDoc[]>();
  const e = await Event.findById(eventId, { compsIssued: 1, waitlistOn: 1, baseline: 1 }).lean();
  const codes = await PresaleCode.find({ eventId }).lean();
  return {
    tiers: ts.map((t) => ({ ...tierView(t), sold: t.sold, held: t.held, locked: t.state === 'sold out' })),
    autoAdvance: ts.every((t) => t.autoAdvance),
    presales: codes.map((c) => ({ id: String(c._id), code: c.code, priceCents: c.priceCents, limit: c.limit, used: c.used, held: c.held, active: c.active })),
    launch: { preRegistrations: e?.baseline?.preRegistrations ?? 0, onSaleAt: e?.baseline?.onSaleAt ?? null, compsIssued: e?.compsIssued ?? 0, compLimit: RULES.compLimit, waitlistOn: e?.waitlistOn ?? true },
  };
};

export const addTier = async (eventId: string, b: { name: string; price: number; total: number; startsAt?: Date; endsAt?: Date }, actor: Actor) => {
  const last = await Tier.findOne({ eventId }).sort({ order: -1 }).lean();
  const t = await Tier.create({ eventId, name: b.name, priceCents: b.price * 100, total: b.total, order: (last?.order ?? -1) + 1, state: 'scheduled', window: { startsAt: b.startsAt ?? null, endsAt: b.endsAt ?? null }, autoAdvance: last?.autoAdvance ?? true });
  await audit(actor, 'Added tier', b.name, { eventId, after: { price: b.price, total: b.total } });
  return tierView(t.toObject() as TierDoc);
};

/** Sold-out tiers are locked. Quantity can't go below what's sold and held. Paid buyers keep their price. */
export const editTier = async (eventId: string, id: string, b: { name?: string; price?: number; total?: number; startsAt?: Date; endsAt?: Date }, actor: Actor) => {
  const t = await Tier.findOne({ _id: id, eventId }).lean<TierDoc>();
  if (!t) throw notFound('Tier');
  if (t.state === 'sold out') throw conflict('A sold-out tier is locked', undefined, 'TIER_LOCKED');
  const set: Record<string, unknown> = {};
  if (b.name) set.name = b.name;
  if (b.price != null) set.priceCents = b.price * 100;
  if (b.startsAt) set['window.startsAt'] = b.startsAt;
  if (b.endsAt) set['window.endsAt'] = b.endsAt;
  const filter: Record<string, unknown> = { _id: id, eventId, state: { $ne: 'sold out' } };
  if (b.total != null) { set.total = b.total; filter.$expr = { $lte: [{ $add: ['$sold', '$held'] }, b.total] }; }
  const after = await Tier.findOneAndUpdate(filter, { $set: set }, { new: true }).lean<TierDoc>();
  if (!after) throw conflict(`Quantity can’t go below the ${t.sold + t.held} already sold or held`, { sold: t.sold, held: t.held }, 'BELOW_SOLD');
  await audit(actor, 'Edited tier', t.name, { eventId, before: { name: t.name, priceCents: t.priceCents, total: t.total }, after: set });
  void emitInventory(eventId);
  return tierView(after);
};

export const setAutoAdvance = async (eventId: string, on: boolean, actor: Actor) => {
  await Tier.updateMany({ eventId }, { $set: { autoAdvance: on } });
  await audit(actor, on ? 'Turned on tier auto-advance' : 'Turned off tier auto-advance', 'Tiers', { eventId });
  return { autoAdvance: on };
};

export const setWaitlist = async (eventId: string, on: boolean, actor: Actor) => {
  await Event.updateOne({ _id: eventId }, { $set: { waitlistOn: on } });
  await audit(actor, on ? 'Opened waitlist' : 'Closed waitlist', 'Waitlist', { eventId });
  return { waitlistOn: on };
};

export const createPresale = async (eventId: string, b: { code: string; price: number; limit: number }, actor: Actor) => {
  try {
    const c = await PresaleCode.create({ eventId, code: b.code, priceCents: b.price * 100, limit: b.limit });
    await audit(actor, 'Created presale code', b.code, { eventId, after: { price: b.price, limit: b.limit } });
    return { id: String(c._id), code: c.code, priceCents: c.priceCents, limit: c.limit, used: 0 };
  } catch (e) { if (isDupKey(e)) throw conflict('That code already exists for this event'); throw e; }
};

/** Comp tickets count against capacity (they take seats from the live tier), up to 50 per event. */
export const issueComp = async (eventId: string, b: { name: string; email: string; qty: number; note?: string }, actor: Actor) => {
  const r = await tx(async (session) => {
    const e = await Event.findOneAndUpdate({ _id: eventId, compsIssued: { $lte: RULES.compLimit - b.qty } }, { $inc: { compsIssued: b.qty } }, { new: true, session });
    if (!e) throw conflict(`All ${RULES.compLimit} comp tickets are issued`, undefined, 'COMP_LIMIT');
    const tier = await Tier.findOne({ eventId, state: 'on sale' }, null, { session }).sort({ order: 1 });
    if (!tier) throw conflict('There is no tier on sale to take comp seats from');
    if (!(await reserveTier(tier._id, b.qty, session))) throw conflict(`Not enough seats left in ${tier.name}`);
    const holdId = new Types.ObjectId();
    await Hold.create([{ _id: holdId, eventId, kind: 'tier', tierId: tier._id, qty: b.qty, unitCents: 0, label: `${b.qty} × Comp`, secretHash: sha256(randomToken()), expiresAt: new Date(Date.now() + 600_000) }], { session });
    const [o] = await Order.create([{ code: await nextOrderCode(session), eventId, buyer: { name: b.name, email: b.email }, lines: [{ kind: 'comp', tierId: tier._id, label: `${b.qty} × Comp`, qty: b.qty, unitCents: 0 }], line: `${b.qty} × Comp`, qty: b.qty, admits: b.qty, subtotalCents: 0, feePercent: 0, feeCents: 0, totalCents: 0, payMethod: 'comp', status: 'pending', holdId }], { session });
    await Hold.updateOne({ _id: holdId }, { $set: { orderId: o._id } }, { session });
    const f = await fulfilIn(o._id, session);
    if (!f.ok) throw conflict('The comp ticket could not be issued');
    return { o, issued: e.compsIssued };
  });
  await jobs.add('orderPaid', { orderId: String(r.o._id) });
  await audit(actor, 'Issued comp ticket', `${r.o.code} · ${b.name}`, { eventId, after: { qty: b.qty, note: b.note } });
  return { code: r.o.code, compsIssued: r.issued, compLimit: RULES.compLimit };
};

/** Tells the notify list once that tickets are open. Called on approval, restore, or new stock. */
export const notifyRelease = async ({ eventId }: { eventId: string }) => {
  const { sendEmail, templates } = await import('../../lib/notify.js');
  const { env } = await import('../../config/env.js');
  const e = await Event.findById(eventId, { name: 1, legacyId: 1, slug: 1, status: 1 }).lean();
  if (!e || e.status !== 'live') return;
  const list = await NotifyEntry.find({ eventId, notifiedAt: null }).limit(5000).lean();
  const link = `${env.webOrigin}/event.html${e.legacyId != null ? `#e${e.legacyId}` : `?event=${e.slug}`}`;
  for (const n of list) {
    const claimed = await NotifyEntry.updateOne({ _id: n._id, notifiedAt: null }, { $set: { notifiedAt: new Date() } });
    if (!claimed.modifiedCount) continue;
    const m = templates.notifyRelease({ event: e.name, link });
    await sendEmail({ to: n.email, subject: m.subject, text: m.text, tag: 'notify-release' });
  }
};

export const assertQty = (q: number) => { if (q < 1 || q > RULES.maxGaQty) throw badRequest('Choose 1 to 10 tickets'); };
