/*
 * Split pay. The lead picks a group of 2 to 6 and pays first. Each friend gets a personal link.
 * The whole reservation is held for 48 hours from the lead's payment. Tickets issue only when every share is paid.
 * If the group isn't complete in time, the inventory is released and every paid share is refunded.
 * Share links use a token derived from the share id with the server key: unguessable, stored only as a hash,
 * single use (a paid share's link stops working) and dead once the group closes.
 */
import { Types, type ClientSession } from 'mongoose';
import { RULES, type SplitMaths, shareAmounts } from '@void/shared';
import { env } from '../../config/env.js';
import { tx } from '../../db/connect.js';
import { Event, Hold, Order, Payment, SplitGroup, SplitShare, User, type EventDoc, type OrderDoc, type PaymentDoc } from '../../db/models/index.js';
import { derivedToken, sha256 } from '../../lib/crypto.js';
import { AppError, conflict, gone, notFound } from '../../lib/errors.js';
import { jobs } from '../../lib/jobs.js';
import { sendEmail, templates } from '../../lib/notify.js';
import { buildCheckout } from '../../lib/payhere.js';
import { audit, getSettings, nextSplitCode, SYSTEM, type Actor } from '../../lib/platform.js';
import { emit } from '../../lib/realtime.js';
import { emitInventory } from '../holds/service.js';
import { fulfilIn, releaseOrderInventoryIn } from '../orders/fulfil.js';
import { refundPaymentRecord } from '../payments/service.js';
import { holdTable, reserveTier } from '../tiers/inventory.js';

export const shareToken = (shareId: Types.ObjectId | string) => derivedToken('split', String(shareId));
export const shareLink = (token: string) => `${env.webOrigin}/event.html?split=${token}`;

export const createGroupIn = async (o: OrderDoc | InstanceType<typeof Order>, s: SplitMaths, friends: { name?: string; email?: string }[], leadUserId: string | null, session: ClientSession) => {
  const [g] = await SplitGroup.create([{ code: await nextSplitCode(session), orderId: o._id, eventId: o.eventId, leadUserId, leadName: o.buyer.name, size: s.size, shareCents: s.shareCents, leadShareCents: s.leadShareCents, status: 'open', expiresAt: null }], { session });
  const amounts = shareAmounts(s);
  const docs = amounts.map((amountCents, index) => {
    const _id = new Types.ObjectId();
    const f = index > 0 ? friends[index - 1] : undefined;
    return { _id, groupId: g._id, orderId: o._id, index, amountCents, status: 'waiting', name: index === 0 ? o.buyer.name : f?.name ?? null, email: index === 0 ? o.buyer.email : f?.email ?? null, tokenHash: index === 0 ? null : sha256(shareToken(_id)) };
  });
  await SplitShare.create(docs, { session, ordered: true });
  return g;
};

const loadByToken = async (token: string) => {
  const share = await SplitShare.findOne({ tokenHash: sha256(token) }).lean();
  if (!share) throw notFound('That share link');
  const group = await SplitGroup.findById(share.groupId).lean();
  const order = await Order.findById(share.orderId).lean<OrderDoc>();
  const event = order ? await Event.findById(order.eventId).lean<EventDoc>() : null;
  if (!group || !order || !event) throw notFound('That share link');
  return { share, group, order, event };
};

/** GET /split/{token}: a friend's share, the event and the lead's first name. */
export const viewShare = async (token: string) => {
  const { share, group, order, event } = await loadByToken(token);
  const paid = await SplitShare.countDocuments({ groupId: group._id, status: 'paid' });
  return {
    share: { index: share.index, amountCents: share.amountCents, status: share.status },
    group: { code: group.code, size: group.size, paid, status: group.status, expiresAt: group.expiresAt?.toISOString() ?? null, leadPaid: !!group.expiresAt },
    lead: order.buyer.name.split(' ')[0], line: order.line,
    event: { id: String(event._id), slug: event.slug, legacyId: event.legacyId ?? null, name: event.name, startsAt: event.startsAt.toISOString(), venue: event.venueName, city: event.city, art: event.art },
  };
};

/** POST /split/{token}/pay: starts that friend's PayHere payment. */
export const payByToken = async (token: string, buyer: { name: string; email: string; mobile: string }) => {
  const { share, group, order, event } = await loadByToken(token);
  if (share.status !== 'waiting') throw new AppError(410, 'SHARE_PAID', 'This share is already paid');
  if (group.status !== 'open') throw gone(group.status === 'complete' ? 'Everyone has paid. See you there.' : 'This group booking was released');
  if (!group.expiresAt) throw conflict(`${order.buyer.name.split(' ')[0]} hasn’t paid their share yet. Try again once they have.`, undefined, 'LEAD_NOT_PAID');
  if (group.expiresAt.getTime() <= Date.now()) throw gone('Time ran out for this group');
  await SplitShare.updateOne({ _id: share._id, status: 'waiting' }, { $set: { name: buyer.name, email: buyer.email } });
  const ret = `${env.webOrigin}/event.html?split=${token}`;
  return {
    payment: buildCheckout({ orderId: `${order.code}-S${share.index}`, amountCents: share.amountCents, items: `${event.name} · ${order.line} · share ${share.index + 1} of ${group.size}`, buyer, returnUrl: ret, cancelUrl: ret, custom1: 'share', custom2: String(share.index) }),
    ...(env.demoMode ? { demo: { providerOrderId: `${order.code}-S${share.index}` } } : {}),
  };
};

/** The lead's hold lapsed before they paid: try to take the same seats or table again, held until the group's deadline. */
const reHoldIn = async (o: OrderDoc, expiresAt: Date, session: ClientSession) => {
  const line = o.lines[0];
  const holdId = new Types.ObjectId();
  if (line.tierId) { if (!(await reserveTier(line.tierId, line.qty, session, { requireOnSale: false }))) return false; }
  else if (line.tableId) { if (!(await holdTable(line.tableId, holdId, session))) return false; }
  else return false;
  await Hold.create([{ _id: holdId, eventId: o.eventId, userId: o.userId, kind: line.tableId ? 'table' : 'tier', tierId: line.tierId, tableId: line.tableId, tableCode: line.tableCode, qty: line.qty, unitCents: line.unitCents, label: o.line, presaleCodeId: line.presaleCodeId, secretHash: sha256(String(holdId)), expiresAt, orderId: o._id }], { session });
  await Order.updateOne({ _id: o._id }, { $set: { holdId } }, { session });
  return true;
};

/** Completion for one share's verified payment. */
export const payShare = async (p: PaymentDoc) => {
  const settings = await getSettings();
  const r = await tx(async (session) => {
    const share = await SplitShare.findOneAndUpdate({ _id: p.splitShareId, status: 'waiting' }, { $set: { status: 'paid', paymentId: p._id, paidAt: new Date() } }, { new: true, session });
    if (!share) return { kind: 'already' as const };
    const group = await SplitGroup.findById(share.groupId, null, { session });
    const order = await Order.findById(share.orderId, null, { session }).lean<OrderDoc>();
    if (!group || !order) return { kind: 'closed' as const };
    if (group.status !== 'open') return { kind: 'closed' as const };
    let leadPaid = false;
    if (share.index === 0) {
      const expiresAt = new Date(Date.now() + settings.splitHoldHours * 3_600_000);
      await SplitGroup.updateOne({ _id: group._id }, { $set: { expiresAt } }, { session });
      await Order.updateOne({ _id: order._id, status: { $in: ['pending', 'cancelled'] } }, { $set: { status: 'split pending', cancelledAt: null } }, { session });
      if (!order.counted) {
        const kept = order.holdId ? await Hold.findOneAndUpdate({ _id: order.holdId, status: 'active' }, { $set: { expiresAt } }, { session }) : null;
        if (!kept && !(await reHoldIn(order, expiresAt, session))) return { kind: 'no inventory' as const };
      }
      leadPaid = true;
    }
    const paid = await SplitShare.countDocuments({ groupId: group._id, status: 'paid' }).session(session);
    let complete = false;
    if (paid >= group.size) {
      await SplitGroup.updateOne({ _id: group._id, status: 'open' }, { $set: { status: 'complete' } }, { session });
      const f = await fulfilIn(order._id, session);
      if (!f.ok) throw new Error(`split fulfil failed: ${f.reason}`);
      complete = true;
    }
    return { kind: 'ok' as const, leadPaid, complete, groupId: group._id, orderId: order._id, eventId: order.eventId, paid, size: group.size };
  });
  if (r.kind === 'closed' || r.kind === 'no inventory') {
    await refundPaymentRecord(p, r.kind === 'closed' ? 'Your group booking had already been released' : 'Sold out before your group could hold its seats');
    if (r.kind === 'no inventory') await releaseGroup(String((await SplitShare.findById(p.splitShareId))?.groupId), 'no inventory', SYSTEM);
    return r;
  }
  if (r.kind !== 'ok') return r;
  emit(`split.${r.groupId}`, 'share-paid', { paid: r.paid, size: r.size, complete: r.complete });
  if (r.leadPaid) await afterLeadPaid(String(r.groupId));
  if (r.complete) { await clearGroupJobs(String(r.groupId)); await jobs.add('orderPaid', { orderId: String(r.orderId) }); }
  void emitInventory(r.eventId);
  return r;
};

const clearGroupJobs = async (id: string) => { for (const j of [`split-${id}`, `split-${id}-r24`, `split-${id}-r6`]) await jobs.remove(j); };

const scheduleGroupJobs = async (id: string, expiresAt: Date) => {
  await jobs.at('expireSplit', expiresAt, { groupId: id }, `split-${id}`);
  for (const h of [24, RULES.splitWarnHours]) {
    const at = new Date(expiresAt.getTime() - h * 3_600_000);
    if (at.getTime() > Date.now()) await jobs.at('splitReminder', at, { groupId: id, hours: h }, `split-${id}-r${h}`);
  }
};

/** Once the lead pays: start the clock and email every friend we have an address for. */
export const afterLeadPaid = async (groupId: string) => {
  const g = await SplitGroup.findById(groupId).lean();
  if (!g?.expiresAt) return;
  await scheduleGroupJobs(groupId, g.expiresAt);
  const order = await Order.findById(g.orderId).lean<OrderDoc>();
  const event = order ? await Event.findById(order.eventId).lean<EventDoc>() : null;
  if (!order || !event) return;
  const friends = await SplitShare.find({ groupId: g._id, index: { $gt: 0 }, status: 'waiting', email: { $ne: null } }).lean();
  for (const f of friends) {
    const m = templates.splitInvite({ lead: order.buyer.name.split(' ')[0], event: event.name, startsAt: event.startsAt, shareCents: f.amountCents, link: shareLink(shareToken(f._id)), expiresAt: g.expiresAt });
    await sendEmail({ to: f.email!, subject: m.subject, text: m.text, tag: 'split-invite' });
  }
};

/** Releases a group: inventory back on sale, paid shares refunded, everyone told. Safe to run twice. */
export const releaseGroup = async (groupId: string, reason: 'expired' | 'released by organizer' | 'no inventory', actor: Actor) => {
  const r = await tx(async (s) => {
    const g = await SplitGroup.findOneAndUpdate({ _id: groupId, status: 'open' }, { $set: { status: 'released', releasedReason: reason } }, { new: true, session: s });
    if (!g) return null;
    const o = await Order.findById(g.orderId, null, { session: s }).lean<OrderDoc>();
    if (!o) return null;
    await releaseOrderInventoryIn(o, s);
    const paid = await SplitShare.countDocuments({ groupId: g._id, status: 'paid' }).session(s);
    await Order.updateOne({ _id: o._id }, { $set: { status: paid ? 'refunded' : 'cancelled', cancelledAt: new Date() } }, { session: s });
    return { g, o };
  });
  if (!r) return null;
  const paidShares = await SplitShare.find({ groupId: r.g._id, status: 'paid' }).lean();
  let refunded = 0;
  for (const sh of paidShares) {
    const p = sh.paymentId ? await Payment.findById(sh.paymentId).lean<PaymentDoc>() : null;
    if (p) { const out = await refundPaymentRecord(p, `Group booking ${r.g.code} was released`); if (out.ok) refunded += sh.amountCents; }
    else await SplitShare.updateOne({ _id: sh._id }, { $set: { status: 'refunded' } });
  }
  if (refunded) await Order.updateOne({ _id: r.o._id }, { $inc: { refundedCents: refunded } });
  await clearGroupJobs(groupId);
  const ev = await Event.findById(r.o.eventId, { name: 1 }).lean<{ name: string }>();
  const everyone = await SplitShare.find({ groupId: r.g._id, email: { $ne: null } }).lean();
  for (const sh of everyone) {
    const m = templates.splitReleased({ event: ev?.name ?? '', refundedCents: sh.paymentId ? sh.amountCents : 0 });
    await sendEmail({ to: sh.email!, subject: m.subject, text: m.text, tag: 'split-released' });
  }
  await audit(actor, 'Released split group', r.g.code, { eventId: r.o.eventId, result: paidShares.length ? 'Refunded' : 'Released', after: { reason, refundedCents: refunded } });
  emit(`split.${groupId}`, 'released', { reason });
  void emitInventory(r.o.eventId);
  return { code: r.g.code, refundedCents: refunded, sharesRefunded: paidShares.length };
};

export const expireSplit = async ({ groupId }: { groupId: string }) => {
  const g = await SplitGroup.findById(groupId, { status: 1, expiresAt: 1 }).lean();
  if (!g || g.status !== 'open' || !g.expiresAt || g.expiresAt.getTime() > Date.now() + 1000) return;
  await releaseGroup(groupId, 'expired', SYSTEM);
};

/** Organizer: add 48 hours, once. */
export const extendGroup = async (eventId: string, id: string, actor: Actor) => {
  const q = Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id) ? { _id: id } : { code: id.toUpperCase() };
  const g = await SplitGroup.findOne({ ...q, eventId }).lean();
  if (!g) throw notFound('Split group');
  if (g.status !== 'open' || !g.expiresAt) throw conflict('Only an open group whose lead has paid can be extended');
  if (g.extendedBy > 0) throw conflict('This group has already been extended once', undefined, 'ALREADY_EXTENDED');
  const add = RULES.splitExtendHours * 3_600_000, expiresAt = new Date(g.expiresAt.getTime() + add);
  const done = await tx(async (s) => {
    const moved = await SplitGroup.findOneAndUpdate({ _id: g._id, status: 'open', extendedBy: 0 }, { $set: { expiresAt, extendedBy: RULES.splitExtendHours, remindersSent: [] } }, { new: true, session: s });
    if (!moved) return null;
    const o = await Order.findById(g.orderId, { holdId: 1 }, { session: s }).lean<OrderDoc>();
    if (o?.holdId) await Hold.updateOne({ _id: o.holdId, status: 'active' }, { $set: { expiresAt } }, { session: s });
    return moved;
  });
  if (!done) throw conflict('This group changed while extending. Try again.');
  await scheduleGroupJobs(String(g._id), expiresAt);
  await audit(actor, 'Extended split group', g.code, { eventId, result: 'Extended 48 hours', before: { expiresAt: g.expiresAt }, after: { expiresAt } });
  return { code: g.code, expiresAt: expiresAt.toISOString() };
};

export const releaseByOrganizer = async (eventId: string, id: string, actor: Actor) => {
  const q = Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id) ? { _id: id } : { code: id.toUpperCase() };
  const g = await SplitGroup.findOne({ ...q, eventId }).lean();
  if (!g) throw notFound('Split group');
  if (g.status !== 'open') throw conflict('This group is already closed');
  return releaseGroup(String(g._id), 'released by organizer', actor);
};

/** Reminder at 24 and 6 hours left. At 6 hours the organizer is warned too. */
export const splitReminder = async ({ groupId, hours }: { groupId: string; hours: number }) => {
  const g = await SplitGroup.findOneAndUpdate({ _id: groupId, status: 'open', remindersSent: { $ne: hours } }, { $push: { remindersSent: hours } }).lean();
  if (!g) return;
  const order = await Order.findById(g.orderId).lean<OrderDoc>();
  const event = order ? await Event.findById(order.eventId).lean<EventDoc>() : null;
  if (!order || !event) return;
  const waiting = await SplitShare.find({ groupId: g._id, index: { $gt: 0 }, status: 'waiting', email: { $ne: null } }).lean();
  for (const f of waiting) {
    const m = templates.splitReminder({ event: event.name, shareCents: f.amountCents, link: shareLink(shareToken(f._id)), hoursLeft: hours });
    await sendEmail({ to: f.email!, subject: m.subject, text: m.text, tag: 'split-reminder' });
  }
  if (hours <= RULES.splitWarnHours && event.organizerId) {
    const org = await User.findById(event.organizerId, { email: 1, notifications: 1 }).lean();
    if (org?.notifications?.splitReminders !== false && org?.email) {
      const m = templates.organizerAlert({ event: event.name, line: `Split group ${g.code} expires in ${hours} hours with ${waiting.length} shares unpaid` });
      await sendEmail({ to: org.email, subject: m.subject, text: m.text, tag: 'organizer-alert' });
    }
  }
};

/** The sweep: expire overdue groups and send any reminder that was missed. */
export const sweepSplits = async () => {
  const now = Date.now();
  const due = await SplitGroup.find({ status: 'open', expiresAt: { $ne: null, $lte: new Date(now) } }, { _id: 1 }).limit(200).lean();
  for (const g of due) await releaseGroup(String(g._id), 'expired', SYSTEM);
  for (const h of [24, RULES.splitWarnHours]) {
    const soon = await SplitGroup.find({ status: 'open', expiresAt: { $gt: new Date(now), $lte: new Date(now + h * 3_600_000) }, remindersSent: { $ne: h } }, { _id: 1 }).limit(200).lean();
    for (const g of soon) await splitReminder({ groupId: String(g._id), hours: h });
  }
  return due.length;
};

/* ---------- Organizer screens ---------- */
export const listGroups = async (eventId: string) => {
  const groups = await SplitGroup.find({ eventId }).sort({ createdAt: -1 }).lean();
  const orders = new Map((await Order.find({ _id: { $in: groups.map((g) => g.orderId) } }, { code: 1, line: 1, buyer: 1 }).lean<OrderDoc[]>()).map((o) => [String(o._id), o]));
  const counts = await SplitShare.aggregate<{ _id: Types.ObjectId; paid: number }>([{ $match: { groupId: { $in: groups.map((g) => g._id) }, status: 'paid' } }, { $group: { _id: '$groupId', paid: { $sum: 1 } } }]);
  const paid = new Map(counts.map((c) => [String(c._id), c.paid]));
  const now = Date.now();
  const rows = groups.map((g) => {
    const o = orders.get(String(g.orderId)), p = paid.get(String(g._id)) ?? 0, ms = g.expiresAt ? g.expiresAt.getTime() - now : null;
    return {
      id: String(g._id), code: g.code, orderCode: o?.code ?? '', lead: g.leadName, item: o?.line ?? '', size: g.size, paid: p,
      shareCents: g.shareCents, stillToPayCents: (g.size - p) * g.shareCents, expiresAt: g.expiresAt?.toISOString() ?? null,
      hoursLeft: ms == null ? null : Math.max(0, Math.round(ms / 3_600_000)), warning: ms != null && ms < RULES.splitWarnHours * 3_600_000,
      status: g.status, extended: g.extendedBy > 0,
    };
  });
  const open = rows.filter((r) => r.status === 'open');
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  return {
    kpis: { openGroups: open.length, stillToPayCents: open.reduce((n, r) => n + r.stillToPayCents, 0), releasedThisMonth: await SplitGroup.countDocuments({ eventId, status: 'released', updatedAt: { $gte: monthStart } }) },
    groups: rows,
  };
};
