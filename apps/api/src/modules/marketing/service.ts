/* Tracked links, SMS and email to ticket holders, newsletter. Campaign sends respect marketing consent and carry an unsubscribe link. */
import { RULES, smsTextLength } from './sms.js';
import { env } from '../../config/env.js';
import { Campaign, Event, Message, Newsletter, Order, Ticket, User } from '../../db/models/index.js';
import { derivedToken, sha256 } from '../../lib/crypto.js';
import { conflict, isDupKey, notFound } from '../../lib/errors.js';
import { sendEmail, sendSms, smsText, templates } from '../../lib/notify.js';
import { audit, type Actor } from '../../lib/platform.js';

export const listCampaigns = async (eventId: string) => {
  const cs = await Campaign.find({ eventId }).sort({ clicks: -1 }).lean();
  return cs.map((c) => ({ id: String(c._id), name: c.name, ref: c.ref, clicks: c.clicks, sales: c.sales, conversionPercent: c.clicks ? Math.round((c.sales / c.clicks) * 1000) / 10 : 0, revenueCents: c.revenueCents, url: `${env.apiPublicUrl}/api/v1/r/${c.ref}` }));
};

export const createCampaign = async (eventId: string, b: { name: string; ref: string }, actor: Actor) => {
  try { await Campaign.create({ eventId, ...b }); } catch (e) { if (isDupKey(e)) throw conflict('That link name is taken. Try another.'); throw e; }
  await audit(actor, 'Created tracked link', b.ref, { eventId });
  return (await listCampaigns(eventId)).find((c) => c.ref === b.ref);
};

/** GET /r/{ref}: count the click, tag the browser, send them to the event. */
export const trackClick = async (ref: string) => {
  const c = await Campaign.findOneAndUpdate({ ref: ref.toLowerCase() }, { $inc: { clicks: 1 } }, { new: true }).lean();
  if (!c) return { url: env.webOrigin, ref: null };
  const e = await Event.findById(c.eventId, { legacyId: 1, slug: 1 }).lean();
  return { ref: c.ref, url: `${env.webOrigin}/event.html${e?.legacyId != null ? `#e${e.legacyId}` : `?event=${e?.slug ?? ''}`}` };
};

type Audience = 'all' | 'ga' | 'vip' | 'split pending';
/** Ticket holders for the audience. Marketing goes only to people who said yes to it. */
const recipients = async (eventId: string, audience: Audience) => {
  const status = audience === 'split pending' ? ['split pending'] : ['paid', 'partially refunded'];
  const kind = audience === 'ga' ? { 'lines.kind': { $ne: 'table' } } : audience === 'vip' ? { 'lines.kind': 'table' } : {};
  const os = await Order.find({ eventId, status: { $in: status }, ...kind }, { buyer: 1, marketingConsent: 1, userId: 1 }).lean();
  const users = new Map((await User.find({ _id: { $in: os.map((o) => o.userId).filter(Boolean) } }, { 'marketingConsent.given': 1 }).lean()).map((u) => [String(u._id), !!u.marketingConsent?.given]));
  const unsub = new Set((await Newsletter.find({ unsubscribedAt: { $ne: null } }, { email: 1 }).lean()).map((n) => n.email));
  const seen = new Map<string, { email: string; mobile?: string | null; consent: boolean }>();
  for (const o of os) {
    const consent = (o.marketingConsent || (o.userId && users.get(String(o.userId)))) && !unsub.has(o.buyer.email);
    const prev = seen.get(o.buyer.email);
    seen.set(o.buyer.email, { email: o.buyer.email, mobile: o.buyer.mobile, consent: !!(consent || prev?.consent) });
  }
  return [...seen.values()];
};

export const unsubscribeUrl = (email: string) => `${env.apiPublicUrl}/api/v1/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${derivedToken('unsub', email)}`;

export const previewMessage = async (eventId: string, b: { channel: 'sms' | 'email'; audience: Audience; subject?: string; body: string }) => {
  const rs = await recipients(eventId, b.audience);
  const ok = rs.filter((r) => r.consent && (b.channel === 'email' || r.mobile));
  return {
    recipients: ok.length, skippedNoConsent: rs.length - ok.length, characters: b.body.length, maxCharacters: b.channel === 'sms' ? RULES.smsMaxChars : null,
    costCents: b.channel === 'sms' ? ok.length * RULES.smsCostCents : 0,
    preview: b.channel === 'sms' ? smsText(b.body) : templates.campaign({ subject: b.subject ?? '', body: b.body, unsubscribeUrl: unsubscribeUrl('you@example.com') }).text,
    segments: b.channel === 'sms' ? smsTextLength(b.body) : null,
  };
};

export const sendMessage = async (eventId: string, b: { channel: 'sms' | 'email'; audience: Audience; subject?: string; body: string }, actor: Actor) => {
  const rs = (await recipients(eventId, b.audience)).filter((r) => r.consent && (b.channel === 'email' || r.mobile));
  const m = await Message.create({ eventId, channel: b.channel, audience: b.audience, subject: b.subject, body: b.body, recipients: rs.length, costCents: b.channel === 'sms' ? rs.length * RULES.smsCostCents : 0, status: 'sending', sentBy: actor.id });
  let failed = 0;
  for (const r of rs) {
    const out = b.channel === 'sms'
      ? await sendSms({ to: r.mobile!, body: `${b.body}`, tag: 'campaign' })
      : await sendEmail({ to: r.email, ...templates.campaign({ subject: b.subject!, body: b.body, unsubscribeUrl: unsubscribeUrl(r.email) }), tag: 'campaign' });
    if (!out.ok) failed++;
  }
  await Message.updateOne({ _id: m._id }, { $set: { status: failed === rs.length && rs.length ? 'failed' : 'sent', sentAt: new Date() } });
  await audit(actor, b.channel === 'sms' ? 'Sent SMS to ticket holders' : 'Emailed ticket holders', `${rs.length} recipients`, { eventId, after: { audience: b.audience, costCents: m.costCents, failed } });
  return { id: String(m._id), recipients: rs.length, costCents: m.costCents, failed };
};

/* ---------- Newsletter ---------- */
export const subscribe = async (email: string) => {
  await Newsletter.updateOne({ email }, { $set: { consentAt: new Date(), unsubscribedAt: null, unsubscribeTokenHash: sha256(derivedToken('unsub', email)) } }, { upsert: true });
  return { ok: true, message: 'You’re in. See you out there.' };
};

export const unsubscribe = async (email: string, token: string) => {
  const n = await Newsletter.findOne({ email: email.toLowerCase(), unsubscribeTokenHash: sha256(token) });
  if (!n) {
    /* Ticket holders who were never on the newsletter can still opt out of campaigns. */
    if (derivedToken('unsub', email.toLowerCase()) !== token) throw notFound('That unsubscribe link');
    await Newsletter.updateOne({ email: email.toLowerCase() }, { $set: { consentAt: new Date(), unsubscribedAt: new Date(), unsubscribeTokenHash: sha256(token) } }, { upsert: true });
  } else { n.unsubscribedAt = new Date(); await n.save(); }
  await User.updateOne({ email: email.toLowerCase() }, { $set: { 'marketingConsent.given': false, 'marketingConsent.at': new Date() } });
  return { ok: true };
};

export const ticketHolderCount = (eventId: string) => Ticket.countDocuments({ eventId, status: { $in: ['valid', 'used'] } });
