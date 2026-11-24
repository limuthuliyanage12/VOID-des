/*
 * PDPA (Sri Lanka, Act No. 9 of 2022, core duties from 1 Jan 2027): a person can see, export and delete their data,
 * requests queue for an admin, and a nightly scrub applies the retention rules in settings.
 */
import { RULES } from '@void/shared';
import { Event, GateStaff, NotifyEntry, Newsletter, Order, PrivacyRequest, RefundRequest, Scan, Session, SplitShare, Ticket, Transfer, User, type OrderDoc } from '../../db/models/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import { koko } from '../../lib/koko.js';
import { sendEmail, templates } from '../../lib/notify.js';
import { audit, getSettings, SYSTEM } from '../../lib/platform.js';
import type { AccessClaims } from '../../lib/tokens.js';
import { KokoPlan, SplitGroup } from '../../db/models/index.js';
import { money } from '../finance/service.js';

/** Everything VOID holds about the signed-in person, as JSON. */
export const exportMyData = async (a: AccessClaims) => {
  const u = await User.findById(a.sub, { passwordHash: 0, 'totp.secretEnc': 0, invite: 0 }).lean();
  if (!u) throw notFound('Account');
  const or = { $or: [{ userId: u._id }, { 'buyer.email': u.email }] };
  return {
    exportedAt: new Date().toISOString(), account: u,
    orders: await Order.find(or, { viewTokenHash: 0 }).lean(),
    tickets: await Ticket.find({ $or: [{ holderUserId: u._id }, { holderEmail: u.email }] }).lean(),
    transfers: await Transfer.find({ $or: [{ fromUserId: u._id }, { toEmail: u.email }] }, { tokenHash: 0 }).lean(),
    refundRequests: await RefundRequest.find({ $or: [{ requestedBy: u._id }, { requesterEmail: u.email }] }).lean(),
    splitShares: await SplitShare.find({ email: u.email }, { tokenHash: 0 }).lean(),
    lists: { notify: await NotifyEntry.find({ email: u.email }).lean(), newsletter: await Newsletter.findOne({ email: u.email }, { unsubscribeTokenHash: 0 }).lean() },
    privacyRequests: await PrivacyRequest.find({ email: u.email }).lean(),
  };
};

/**
 * Deletes the account. Paid orders must be kept for tax and refunds, so they are anonymised rather than removed,
 * and tickets for events still to come are void unless the person keeps the account.
 */
export const deleteMe = async (a: AccessClaims) => {
  const u = await User.findById(a.sub);
  if (!u) throw notFound('Account');
  if (u.role !== 'fan') throw conflict('Staff accounts are closed by the super admin');
  const upcoming = await Ticket.countDocuments({ $or: [{ holderUserId: u._id }, { holderEmail: u.email }], status: 'valid' });
  if (upcoming) throw conflict(`You still have ${upcoming} valid ticket${upcoming > 1 ? 's' : ''}. Transfer or refund them first, or ask us by email.`, { upcoming }, 'HAS_TICKETS');
  const email = u.email, gone = `deleted-${u._id}@void.invalid`;
  await Order.updateMany({ $or: [{ userId: u._id }, { 'buyer.email': email }] }, { $set: { 'buyer.name': 'Deleted user', 'buyer.email': gone, 'buyer.mobile': null, anonymisedAt: new Date() } });
  await Ticket.updateMany({ $or: [{ holderUserId: u._id }, { holderEmail: email }] }, { $set: { holderName: 'Deleted user', holderEmail: gone } });
  await SplitShare.updateMany({ email }, { $set: { email: null, name: null } });
  await NotifyEntry.deleteMany({ email });
  await Newsletter.deleteMany({ email });
  await Session.deleteMany({ userId: u._id });
  await User.updateOne({ _id: u._id }, { $set: { name: 'Deleted user', email: gone, phone: null, status: 'deleted', marketingConsent: { given: false, at: new Date() } }, $unset: { passwordHash: 1, googleId: 1 } });
  await audit({ id: u._id, label: 'Account holder' }, 'Deleted own account', String(u._id), { result: 'Anonymised' });
  return { ok: true };
};

export const submitPrivacyRequest = async (b: { kind: 'access' | 'export' | 'delete' | 'correct'; email: string; details?: string }, a?: AccessClaims) => {
  const r = await PrivacyRequest.create({ ...b, userId: a?.sub ?? null, dueAt: new Date(Date.now() + 21 * 86_400_000) });
  const s = await getSettings();
  await sendEmail({ to: b.email, subject: 'We have your privacy request', text: `We received your ${b.kind} request and will answer by ${r.dueAt.toDateString()}. Contact: ${s.dataProtectionContact}`, tag: 'privacy' });
  return { id: String(r._id), dueAt: r.dueAt };
};

/** Nightly. Deletes or anonymises data past its retention period. */
export const scrubPersonalData = async () => {
  const { retention } = await getSettings();
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);
  const past = await Event.find({ endsAt: { $lte: days(retention.notifyListDays) } }, { _id: 1 }).lean();
  const n1 = (await NotifyEntry.deleteMany({ eventId: { $in: past.map((e) => e._id) } })).deletedCount;
  const old = await Event.find({ endsAt: { $lte: days(retention.guestContactDays) } }, { _id: 1 }).lean();
  const n2 = (await Order.updateMany({ eventId: { $in: old.map((e) => e._id) }, userId: null, anonymisedAt: null }, { $set: { 'buyer.mobile': null, anonymisedAt: new Date() } })).modifiedCount;
  const n3 = (await Scan.updateMany({ scannedAt: { $lte: days(retention.scanDeviceDays) }, deviceId: { $ne: 'scrubbed' } }, { $set: { deviceId: 'scrubbed' } })).modifiedCount;
  const n4 = (await Newsletter.deleteMany({ unsubscribedAt: { $ne: null, $lte: days(retention.unsubscribedDays) } })).deletedCount;
  const n5 = (await Session.deleteMany({ $or: [{ expiresAt: { $lte: new Date() } }, { revokedAt: { $lte: days(7) } }] })).deletedCount;
  if (n1 + n2 + n3 + n4) await audit(SYSTEM, 'Scrubbed personal data', 'Retention rules', { after: { notifyList: n1, guestMobiles: n2, scanDevices: n3, newsletter: n4, sessions: n5 } });
  return { n1, n2, n3, n4, n5 };
};

/** Hourly. Refreshes Koko plan status for the organizer screen. */
export const kokoSync = async () => {
  const plans = await KokoPlan.find({ status: { $in: ['pending approval', 'active'] } }).limit(500).lean();
  for (const p of plans) {
    try { const s = await koko().getPlan(p.kokoRef); await KokoPlan.updateOne({ _id: p._id }, { $set: { status: s.status, received: s.received, lastSyncedAt: new Date() } }); }
    catch { /* try again next hour */ }
  }
};

/** 8 am Colombo. One summary per organizer who wants it. */
export const dailyDigest = async () => {
  const orgs = await User.find({ role: 'organizer', status: 'active', 'notifications.dailyDigest': { $ne: false } }, { email: 1, assignedEventId: 1 }).lean();
  for (const o of orgs) {
    const e = await Event.findById(o.assignedEventId).lean();
    if (!e) continue;
    const yesterday = await Order.countDocuments({ eventId: e._id, status: 'paid', paidAt: { $gte: new Date(Date.now() - 86_400_000) } });
    const soon = await SplitGroup.countDocuments({ eventId: e._id, status: 'open', expiresAt: { $ne: null, $lte: new Date(Date.now() + RULES.splitWarnHours * 3_600_000) } });
    const m = templates.digest({ event: e.name, sold: e.stats.sold, capacity: e.capacity, ordersYesterday: yesterday, grossCents: (await money(e as never)).grossCents, splitsExpiring: soon });
    await sendEmail({ to: o.email, subject: m.subject, text: m.text, tag: 'digest' });
  }
};

/** Organizer "new order" alert, if they want it. */
export const alertNewOrder = async (o: OrderDoc) => {
  const e = await Event.findById(o.eventId, { name: 1, organizerId: 1 }).lean();
  if (!e?.organizerId) return;
  const org = await User.findById(e.organizerId, { email: 1, notifications: 1 }).lean();
  if (!org?.email || org.notifications?.orders === false) return;
  const m = templates.organizerAlert({ event: e.name, line: `New order ${o.code}: ${o.line}` });
  await sendEmail({ to: org.email, subject: m.subject, text: m.text, tag: 'organizer-alert' });
};

export const gateStaffFor = (eventId: string) => GateStaff.find({ eventId }).lean();
