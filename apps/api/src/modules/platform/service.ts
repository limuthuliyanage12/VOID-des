/*
 * Super admin: approvals, pauses, admins, venues, fees, settings, users, audit log, privacy queue and breach log.
 * Every decision writes the append-only audit log with its before and after.
 */
import { eventLabel, formatDate, formatLKR, REVIEW_EVENT_STATUS, RULES, type EventStatus } from '@void/shared';
import { env } from '../../config/env.js';
import { AuditLog, Breach, Event, Layout, Order, Payout, PrivacyRequest, Settings, User, Venue, type EventDoc } from '../../db/models/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { jobs } from '../../lib/jobs.js';
import { sendEmail } from '../../lib/notify.js';
import { audit, getSettings, type Actor } from '../../lib/platform.js';
import { emit } from '../../lib/realtime.js';
import { toCsv } from '../../lib/csv.js';
import { resolveEvent } from '../../middleware/scope.js';
import { money } from '../finance/service.js';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const superLabel = (e: Pick<EventDoc, 'status'>) => (REVIEW_EVENT_STATUS.includes(e.status) ? 'In review' : e.status === 'live' ? 'Live' : eventLabel(e as never) === 'Sales paused' ? 'Suspended' : eventLabel(e as never));

const row = (e: EventDoc) => ({
  id: String(e._id), slug: e.slug, name: e.name, startsAt: e.startsAt, date: formatDate(e.startsAt), venue: e.venueName, city: e.city, region: e.region,
  admin: e.organizerName ?? null, status: e.status, label: superLabel(e), sold: e.stats.sold, grossCents: e.stats.grossCents, capacity: e.capacity,
});

export const overview = async () => {
  const es = await Event.find().lean<EventDoc[]>();
  const [payoutsWaiting, layoutsWaiting, settings] = await Promise.all([Payout.find({ status: 'awaiting approval' }).lean(), Layout.countDocuments({ status: 'awaiting review' }), getSettings()]);
  const sum = (f: (e: EventDoc) => number) => es.reduce((n, e) => n + f(e), 0);
  const by = (k: 'region') => Object.entries(es.reduce<Record<string, number>>((m, e) => ({ ...m, [e[k]]: (m[e[k]] ?? 0) + e.stats.grossCents }), {})).map(([name, grossCents]) => ({ name, grossCents }));
  const inReview = es.filter((e) => REVIEW_EVENT_STATUS.includes(e.status));
  return {
    decisions: {
      eventRequests: inReview.length, payoutBatches: payoutsWaiting.length, payoutAmountCents: payoutsWaiting.reduce((n, p) => n + p.amountCents, 0),
      layoutsToReview: layoutsWaiting, eventsWithoutAdmin: es.filter((e) => !e.organizerId).length,
    },
    kpis: { grossCents: sum((e) => e.stats.grossCents), feesCents: sum((e) => e.stats.feesCents), ticketsSold: sum((e) => e.stats.sold), eventsLive: es.filter((e) => e.status === 'live').length, bookingFeePercent: settings.bookingFeePercent },
    byEvent: es.map(row).sort((a, b) => b.grossCents - a.grossCents), byRegion: by('region'),
    system: { api: 'ok', database: 'ok', jobs: jobs.inline() ? 'in-process' : 'bullmq', payments: env.payhere.sandbox ? 'PayHere sandbox' : 'PayHere live', koko: env.koko.driver },
  };
};

export const overviewCsv = async () => {
  const o = await overview();
  return toCsv(o.byEvent, [{ key: 'name', label: 'Event' }, { key: 'date', label: 'Date' }, { key: 'venue', label: 'Venue' }, { key: 'label', label: 'Status' }, { key: 'sold', label: 'Tickets' }, { key: (r) => Math.round(r.grossCents / 100), label: 'Gross (LKR)' }]);
};

export const listEvents = async (q: { q?: string; status?: string; page: number; limit: number }) => {
  const f: Record<string, unknown> = {};
  if (q.q) { const r = new RegExp(esc(q.q), 'i'); f.$or = [{ name: r }, { venueName: r }, { city: r }, { organizerName: r }]; }
  if (q.status) {
    const s = q.status.toLowerCase();
    f.status = s === 'in review' ? { $in: REVIEW_EVENT_STATUS } : s === 'suspended' || s === 'paused' ? 'suspended' : s;
  }
  const [items, total, all] = await Promise.all([Event.find(f).sort({ startsAt: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean<EventDoc[]>(), Event.countDocuments(f), Event.countDocuments()]);
  return { items: items.map(row), total, page: q.page, limit: q.limit, showing: `Showing ${items.length} of ${all}`, inReview: await Event.countDocuments({ status: { $in: REVIEW_EVENT_STATUS } }) };
};

export const eventDetail = async (ref: string) => {
  const e = await resolveEvent(ref);
  if (!e) throw notFound('Event');
  const ev = e.toObject() as EventDoc;
  const { Tier } = await import('../../db/models/index.js');
  const tiers = await Tier.find({ eventId: ev._id }).sort({ order: 1 }).lean();
  const org = ev.organizerId ? await User.findById(ev.organizerId, { name: 1, email: 1 }).lean() : null;
  return {
    ...row(ev), art: ev.art, paused: ev.status === 'suspended', canApprove: REVIEW_EVENT_STATUS.includes(ev.status), canPause: ['live', 'sold out'].includes(ev.status),
    kpis: { ...(await money(ev)), sold: ev.stats.sold, orders: ev.stats.orders },
    revenueByTier: tiers.map((t) => ({ name: t.name, sold: t.sold, revenueCents: t.sold * t.priceCents })),
    ownership: { organizer: org ? { id: String(org._id), name: org.name, email: org.email } : null, payoutAccount: ev.payoutAccount ?? null },
  };
};

/** Approve to live, or reject with a note. An event with no organizer can't go live. */
export const decideEvent = async (ref: string, to: 'live' | 'rejected', note: string | undefined, actor: Actor) => {
  const e = await resolveEvent(ref);
  if (!e) throw notFound('Event');
  if (!REVIEW_EVENT_STATUS.includes(e.status) && e.status !== 'draft') throw conflict(`This event is ${e.status}, not waiting for a decision`);
  if (to === 'live' && !e.organizerId) throw conflict('An event with no organizer can’t go live. Invite an admin first.', undefined, 'NO_ORGANIZER');
  const before = e.status;
  const done = await Event.findOneAndUpdate({ _id: e._id, status: before }, { $set: { status: to, reviewNote: note ?? null, ...(to === 'live' ? { approvedAt: new Date(), approvedBy: actor.id, salesLabel: 'On sale' } : {}) } }, { new: true });
  if (!done) throw conflict('The event changed. Refresh and try again.');
  if (to === 'live') {
    const { Tier } = await import('../../db/models/index.js');
    const first = await Tier.findOne({ eventId: e._id, state: { $in: ['scheduled', 'up next'] } }).sort({ order: 1 });
    if (first && !(await Tier.exists({ eventId: e._id, state: 'on sale' }))) await Tier.updateOne({ _id: first._id }, { $set: { state: 'on sale' } });
    await jobs.add('notifyRelease', { eventId: String(e._id) });
  }
  await audit(actor, to === 'live' ? 'Approved event' : 'Rejected event', e.name, { eventId: e._id, result: to === 'live' ? 'Live' : 'Rejected', before: { status: before }, after: { status: to, note } });
  emit(`event.${e._id}`, 'status', { status: to });
  return row(done.toObject() as EventDoc);
};

/** Pause sales: checkout and holds answer 423, tickets stay valid, refunds and payouts carry on. Restore returns the earlier status. */
export const suspend = async (ref: string, actor: Actor) => {
  const e = await resolveEvent(ref);
  if (!e) throw notFound('Event');
  if (e.status === 'suspended') throw conflict('Sales are already paused');
  if (!['live', 'sold out'].includes(e.status)) throw conflict('Only a live or sold-out event can be paused');
  const done = await Event.findOneAndUpdate({ _id: e._id, status: e.status }, { $set: { status: 'suspended', statusBeforeSuspend: e.status } }, { new: true });
  if (!done) throw conflict('The event changed. Refresh and try again.');
  await audit(actor, 'Paused sales', e.name, { eventId: e._id, result: 'Suspended', before: { status: e.status }, after: { status: 'suspended' } });
  emit(`event.${e._id}`, 'status', { status: 'suspended', paused: true });
  return row(done.toObject() as EventDoc);
};

export const restore = async (ref: string, actor: Actor) => {
  const e = await resolveEvent(ref);
  if (!e) throw notFound('Event');
  if (e.status !== 'suspended') throw conflict('Sales are not paused');
  const to = (e.statusBeforeSuspend ?? 'live') as EventStatus;
  const done = await Event.findOneAndUpdate({ _id: e._id, status: 'suspended' }, { $set: { status: to, statusBeforeSuspend: null } }, { new: true });
  if (!done) throw conflict('The event changed. Refresh and try again.');
  await audit(actor, 'Restored sales', e.name, { eventId: e._id, result: eventLabel({ status: to }), before: { status: 'suspended' }, after: { status: to } });
  emit(`event.${e._id}`, 'status', { status: to, paused: false });
  if (to === 'live') await jobs.add('notifyRelease', { eventId: String(e._id) });
  return row(done.toObject() as EventDoc);
};

/* ---------- Admins: one admin per event ---------- */
export const listAdmins = async () => {
  const es = await Event.find({}, { name: 1, organizerId: 1, organizerName: 1, startsAt: 1 }).sort({ startsAt: 1 }).lean();
  const users = new Map((await User.find({ role: 'organizer' }, { name: 1, email: 1, status: 1, assignedEventId: 1, lastLoginAt: 1, 'totp.enabled': 1 }).lean()).map((u) => [String(u.assignedEventId), u]));
  return es.map((e) => { const u = users.get(String(e._id)); return { eventId: String(e._id), event: e.name, admin: u ? { id: String(u._id), name: u.name, email: u.email, status: u.status, mfa: !!u.totp?.enabled, lastLoginAt: u.lastLoginAt ?? null } : null, canInvite: !u }; });
};

export const inviteAdmin = async (b: { name: string; email: string; eventId: string }, actor: Actor) => {
  const e = await Event.findById(b.eventId);
  if (!e) throw notFound('Event');
  if (await User.exists({ role: 'organizer', assignedEventId: e._id })) throw conflict('This event already has an admin. One admin per event.', undefined, 'EVENT_HAS_ADMIN');
  const existing = await User.findOne({ email: b.email });
  if (existing && existing.role !== 'fan') throw conflict('That person already has staff access to another workspace. One event per admin.', undefined, 'ADMIN_HAS_EVENT');
  const token = randomToken(24);
  const invite = { tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) };
  const u = existing
    ? await User.findOneAndUpdate({ _id: existing._id }, { $set: { role: 'organizer', assignedEventId: e._id, invite, status: existing.passwordHash ? 'active' : 'invited' } }, { new: true })
    : await User.create({ name: b.name, email: b.email, role: 'organizer', assignedEventId: e._id, status: 'invited', invite });
  await Event.updateOne({ _id: e._id }, { $set: { organizerId: u!._id, organizerName: b.name } });
  const link = `${env.webOrigin}/admin.html?invite=${token}`;
  await sendEmail({ to: b.email, subject: `You’re invited to run ${e.name} on VOID`, text: `Hi ${b.name.split(' ')[0]},\n\nYou’ve been invited as the organizer admin for ${e.name}. You will only see this event.\n\nSet your password here (the link works for 7 days): ${link}\n\nYou’ll also set up an authenticator app for two-step sign-in.`, tag: 'admin-invite' });
  await audit(actor, 'Invited admin', `${b.name} → ${e.name}`, { eventId: e._id, result: 'Invited' });
  return { userId: String(u!._id), eventId: String(e._id), status: u!.status, ...(env.demoMode ? { demoInviteToken: token } : {}) };
};

/* ---------- Venues ---------- */
export const createVenue = async (b: { name: string; city: string; capacity: number; region: 'Colombo' | 'South coast' | 'Hill country'; modelStatus: 'none' | 'in review' | 'ready'; widthM?: number; depthM?: number }, actor: Actor) => {
  const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (await Venue.exists({ slug })) throw conflict('A venue with that name already exists');
  const v = await Venue.create({ ...b, slug });
  await audit(actor, 'Added venue', b.name, { result: b.modelStatus === 'ready' ? 'Ready' : 'Needs a 3D model' });
  return { id: String(v._id), slug, ...b, note: b.modelStatus === 'ready' ? null : 'Organizers can build on this venue once its 3D model is ready.' };
};

export const setVenueModel = async (id: string, url: string, actor: Actor) => {
  const v = await Venue.findByIdAndUpdate(id, { $set: { modelUrl: url, modelStatus: 'in review' } }, { new: true });
  if (!v) throw notFound('Venue');
  await audit(actor, 'Uploaded venue model', v.name, { result: 'In review' });
  return { id, modelUrl: url, modelStatus: v.modelStatus };
};

/* ---------- Fees and settings ---------- */
export const getFees = async () => {
  const s = await getSettings();
  const example = 900_000, fee = Math.round((example * s.bookingFeePercent) / 100 / 100) * 100;
  return { bookingFeePercent: s.bookingFeePercent, min: 0, max: 15, step: 0.5, example: { ticketCents: example, feeCents: fee, totalCents: example + fee, line: `A ${formatLKR(example)} ticket pays ${formatLKR(fee)} in fees, ${formatLKR(example + fee)} in all` }, notSetHere: ['PayHere card fees (charged by PayHere)', 'Koko merchant fees (charged by Koko)', 'SMS at LKR 2.50 each', 'Bank transfer charges on payouts'] };
};

/** Applies to new orders straight away. Orders already placed keep the percent copied onto them. */
export const setFees = async (pct: number, actor: Actor) => {
  const before = await getSettings();
  await Settings.updateOne({ key: 'platform' }, { $set: { bookingFeePercent: pct } }, { upsert: true });
  await audit(actor, 'Changed booking fee', 'Platform', { result: `${pct}%`, before: { bookingFeePercent: before.bookingFeePercent }, after: { bookingFeePercent: pct } });
  return getFees();
};

export const platformSettings = async () => {
  const s = await getSettings();
  return {
    platformName: s.platformName, supportEmail: s.supportEmail, currency: s.currency, timeZone: s.timeZone, dataProtectionContact: s.dataProtectionContact, locked: ['currency', 'timeZone'],
    rules: { splitHoldHours: s.splitHoldHours, seatHoldMinutes: s.seatHoldMinutes, kokoInstalments: s.kokoInstalments, oneEventPerAdmin: true, layoutsNeedReview: true, bookingFeePercent: s.bookingFeePercent, refundReservePercent: s.refundReservePercent, compLimit: RULES.compLimit },
    retention: s.retention, demoMode: env.demoMode,
  };
};

export const patchSettings = async (b: { platformName?: string; supportEmail?: string; dataProtectionContact?: string }, actor: Actor) => {
  const before = await getSettings();
  await Settings.updateOne({ key: 'platform' }, { $set: b });
  await audit(actor, 'Changed platform settings', 'Platform', { before: { platformName: before.platformName, supportEmail: before.supportEmail, dataProtectionContact: before.dataProtectionContact }, after: b });
  return platformSettings();
};

/* ---------- Users and audit ---------- */
export const listUsers = async (q: { q?: string; page: number; limit: number }) => {
  const f: Record<string, unknown> = { role: 'fan', status: { $ne: 'deleted' } };
  if (q.q) { const r = new RegExp(esc(q.q), 'i'); f.$or = [{ name: r }, { email: r }]; }
  const [us, total] = await Promise.all([User.find(f, { name: 1, email: 1, joinedAt: 1, createdAt: 1 }).sort({ joinedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), User.countDocuments(f)]);
  const counts = new Map((await Order.aggregate<{ _id: string; n: number }>([{ $match: { 'buyer.email': { $in: us.map((u) => u.email) }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$buyer.email', n: { $sum: 1 } } }])).map((c) => [c._id, c.n]));
  return { items: us.map((u) => ({ id: String(u._id), name: u.name, email: u.email, orders: counts.get(u.email) ?? 0, joined: formatDate(u.joinedAt ?? u.createdAt as Date) })), total, page: q.page, limit: q.limit };
};

export const listAudit = async (q: { q?: string; page: number; limit: number; eventId?: string }) => {
  const f: Record<string, unknown> = {};
  if (q.eventId) f.eventId = q.eventId;
  if (q.q) { const r = new RegExp(esc(q.q), 'i'); f.$or = [{ action: r }, { target: r }, { actorLabel: r }]; }
  const [items, total] = await Promise.all([AuditLog.find(f).sort({ at: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), AuditLog.countDocuments(f)]);
  return { items: items.map((a) => ({ at: a.at, who: a.actorLabel, action: a.action, target: a.target, result: a.result, before: a.before, after: a.after })), total, page: q.page, limit: q.limit };
};

export const auditCsv = async () => {
  const items = await AuditLog.find().sort({ at: -1 }).limit(10_000).lean();
  return toCsv(items, [{ key: 'at', label: 'Time (UTC)' }, { key: 'actorLabel', label: 'Who' }, { key: 'action', label: 'Action' }, { key: 'target', label: 'Target' }, { key: 'result', label: 'Result' }]);
};

/* ---------- PDPA: requests queue and breach log ---------- */
export const listPrivacyRequests = async (status?: string) => (await PrivacyRequest.find(status ? { status } : {}).sort({ dueAt: 1 }).lean()).map((r) => ({ id: String(r._id), kind: r.kind, email: r.email, status: r.status, dueAt: r.dueAt, due: formatDate(r.dueAt), details: r.details ?? null, note: r.note ?? null }));

export const decidePrivacyRequest = async (id: string, b: { status: 'open' | 'in progress' | 'done' | 'rejected'; note?: string }, actor: Actor) => {
  const r = await PrivacyRequest.findByIdAndUpdate(id, { $set: { status: b.status, note: b.note, handledBy: actor.id, ...(b.status === 'done' || b.status === 'rejected' ? { closedAt: new Date() } : {}) } }, { new: true });
  if (!r) throw notFound('Privacy request');
  await audit(actor, 'Updated privacy request', `${r.kind} · ${r.email}`, { result: b.status });
  return { id, status: r.status };
};

export const logBreach = async (b: { summary: string; detectedAt: Date; affected: number; reportedToAuthorityAt?: Date }, actor: Actor) => {
  if (b.detectedAt.getTime() > Date.now() + 60_000) throw badRequest('Detected time is in the future');
  const x = await Breach.create({ ...b, reportedBy: actor.id });
  await audit(actor, 'Logged data breach', b.summary.slice(0, 60), { result: 'Open', after: { affected: b.affected } });
  const s = await getSettings();
  await sendEmail({ to: s.supportEmail, subject: 'Data breach logged on VOID', text: `A data breach was logged.\n\n${b.summary}\nDetected ${b.detectedAt.toISOString()}. People affected: ${b.affected}.\n\nUnder the PDPA the Data Protection Authority may need to be told. Contact: ${s.dataProtectionContact}`, tag: 'breach-alert' });
  return { id: String(x._id) };
};

export const listBreaches = async () => (await Breach.find().sort({ detectedAt: -1 }).lean()).map((b) => ({ id: String(b._id), summary: b.summary, detectedAt: b.detectedAt, affected: b.affected, reportedToAuthorityAt: b.reportedToAuthorityAt, status: b.status }));
