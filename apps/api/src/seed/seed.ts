/*
 * Seeds exactly the prototype's sample data so the frontend looks the same on day one.
 * Reconciled where the prototype contradicted itself (see README, "Seed notes"):
 *  - Table orders point at tables the seed marks reserved or held (P02 paid, G06 held by split SP-037).
 *  - SP-036 needs an order, so VOID-2701836 exists. The GA split groups are counted inside the 1,842 sold,
 *    as the prototype counted them; releasing one reverses that sale.
 */
import mongoose, { Types } from 'mongoose';
import { parseColombo, colomboDayKey, splitShares, VIP } from '@void/shared';
import { env } from '../config/env.js';
import {
  AuditLog, Campaign, Counter, Event, GateStaff, Hold, Invoice, KokoPlan, Layout, Order, Payment, Payout, PresaleCode, Settings, SplitGroup, SplitShare, Table, Ticket, Tier, User, Venue,
} from '../db/models/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { hashPassword } from '../lib/password.js';
import { ensureEventKey } from '../lib/qr.js';
import { issueTicketsIn } from '../modules/tickets/service.js';
import { tx } from '../db/connect.js';
import { shareToken } from '../modules/split/service.js';
import { AUDIT, BASE_TIERS, CHANNELS, DEMO_PASSWORD, EVENTS, FANS, FLAGSHIP_PHASE3_SOLD, INVOICES, LINKS, LOTUS_POIS, PAID, PAYOUTS, STAFF, TRACKS, VENUES, WEEKLY, layoutObjects } from './data.js';

const R = (lkr: number) => lkr * 100;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ABOUT = (name: string, genre: string, venue: string) => `${name} brings a night of ${genre.toLowerCase()} to ${venue}. Doors open when the night calls: gates at 4 pm, music from 5 pm until 2 am. Look around the room in 3D before you buy, book general admission or a VIP table, and split the bill with friends.`;

export interface SeedAccount { role: string; email: string; password: string; totpSecret?: string; note?: string }

export const seed = async (opts: { force?: boolean } = {}) => {
  if (env.isProd && !opts.force && process.env.SEED_FORCE !== 'yes') throw new Error('Refusing to wipe and seed a production database. Set SEED_FORCE=yes if you really mean it.');
  for (const m of Object.values(mongoose.models)) await m.collection.deleteMany({});
  const now = new Date();
  const before = new Date(now.getTime() - 3_600_000);
  const pw = await hashPassword(DEMO_PASSWORD);
  const accounts: SeedAccount[] = [];

  await Settings.create({ key: 'platform' });

  /* Venues */
  const venues = new Map<string, InstanceType<typeof Venue>>();
  for (const v of VENUES) venues.set(v.name, await Venue.create({ ...v, slug: slug(v.name), pois: v.name === 'Lotus Tower' ? LOTUS_POIS : [], widthM: 80, depthM: 60 }));

  /* People */
  const superAdmin = await User.create({ name: 'Super admin', email: 'super@eventsbythevoid.lk', passwordHash: pw, role: 'super' });
  accounts.push({ role: 'super', email: superAdmin.email, password: DEMO_PASSWORD });
  const fans = new Map<string, InstanceType<typeof User>>();
  for (const f of FANS) fans.set(f.name, await User.create({ name: f.name, email: f.email, passwordHash: pw, role: 'fan', joinedAt: parseColombo(f.joined), marketingConsent: { given: true, at: parseColombo(f.joined) } }));
  accounts.push({ role: 'fan', email: FANS[0].email, password: DEMO_PASSWORD });

  /* Events, tiers and organizers */
  const events: InstanceType<typeof Event>[] = [];
  for (const e of EVENTS) {
    const _id = new Types.ObjectId();
    const statusMap = { 'Selling fast': 'live', 'On sale': 'live', 'Sold out': 'sold out', 'Registering interest': 'registering' } as const;
    let organizerId: Types.ObjectId | null = null;
    if (e.organizer) {
      const u = await User.create({ name: e.organizer, email: `${slug(e.organizer).replace(/-/g, '.')}@organizers.example.com`, passwordHash: pw, role: 'organizer', assignedEventId: _id });
      organizerId = u._id;
      if (e.id === 0) accounts.push({ role: 'organizer', email: u.email, password: DEMO_PASSWORD, note: 'VOID 2027 only' });
    }
    const gross = R(e.gross), fees = Math.round(gross * 0.05), refunds = Math.round(gross * 0.012);
    const flagship = e.id === 0;
    events.push(await Event.create({
      _id, name: e.name, slug: e.slug, legacyId: e.id, venueId: venues.get(e.venue)!._id, venueName: e.venue, city: e.city, region: e.region, genre: e.genre, art: e.art,
      startsAt: parseColombo(`${e.date}T17:00`), gatesAt: parseColombo(`${e.date}T16:00`), endsAt: new Date(parseColombo(`${e.date}T17:00`).getTime() + 9 * 3_600_000),
      fromPriceCents: R(e.from), status: statusMap[e.status], salesLabel: e.status === 'Selling fast' || e.status === 'On sale' ? e.status : null,
      organizerId, organizerName: e.organizer, capacity: e.cap, hasVip: flagship, about: ABOUT(e.name, e.genre, e.venue),
      playlist: { title: 'The warm-up playlist · 24 tracks', url: null, tracks: TRACKS },
      stats: { sold: e.sold, orders: flagship ? 962 : Math.round(e.sold / 1.9), grossCents: gross, ticketGrossCents: gross, tableGrossCents: 0, feesCents: fees, refundsCents: refunds, refundedOrders: Math.round(e.sold * 0.012 / 1.9) },
      baseline: flagship
        ? { weekly: WEEKLY.map(([week, tickets, note]) => ({ week, tickets, note })), channels: CHANNELS.map(([name, tickets]) => ({ name, tickets })), payments: PAID.map(([method, amount]) => ({ method, amountCents: R(amount) })), preRegistrations: 1286, kokoOrders: 123, onSaleAt: parseColombo('2027-01-01T10:00') }
        : {},
      compsIssued: flagship ? 24 : 0, payoutAccount: { bank: 'Commercial Bank', last4: flagship ? '4821' : String(1000 + e.id * 1111).slice(-4) },
      approvedAt: e.status !== 'Registering interest' ? before : undefined, approvedBy: e.status !== 'Registering interest' ? superAdmin._id : undefined,
    }));
    const k = e.from / 9000, soldOut = e.status === 'Sold out', registering = e.status === 'Registering interest';
    for (const [i, [name, price, total]] of BASE_TIERS.entries()) {
      const p3Left = flagship ? total - FLAGSHIP_PHASE3_SOLD : Math.round(total * (1 - Math.min(0.9, e.sold / e.cap)));
      const state = registering ? (i === 0 ? 'up next' : 'scheduled') : soldOut ? 'sold out' : i < 3 ? 'sold out' : i === 3 ? 'on sale' : 'up next';
      const sold = registering ? 0 : soldOut || i < 3 ? total : i === 3 ? total - p3Left : 0;
      await Tier.create({ eventId: _id, name, priceCents: R(Math.round((price * k) / 100) * 100), total, sold, order: i, state, autoAdvance: true });
    }
  }
  const flag = events[0];
  const tiers = await Tier.find({ eventId: flag._id }).sort({ order: 1 }).lean();
  const p3 = tiers[3];

  await PresaleCode.create({ eventId: flag._id, code: 'VOIDFRIENDS', priceCents: R(7500), limit: 100, used: 32 });

  /* VIP tables: G03, P02, P06 reserved; G06, P05 held. */
  const tables = new Map<string, Types.ObjectId>();
  for (const tier of ['gold', 'platinum'] as const) for (let i = 1; i <= 8; i++) {
    const code = VIP[tier].prefix + String(i).padStart(2, '0');
    const status = ['G03', 'P02', 'P06'].includes(code) ? 'reserved' : 'available';
    tables.set(code, (await Table.create({ eventId: flag._id, code, tier, seats: VIP[tier].seats, minSpendCents: VIP[tier].minSpendCents, status }))._id);
  }

  /* Layouts: v2 approved and live, v3 published and waiting for review. */
  await Layout.create({ eventId: flag._id, version: 2, status: 'approved', live: true, objects: layoutObjects(), reviewedBy: superAdmin._id, reviewedAt: before });
  await Layout.create({ eventId: flag._id, version: 3, status: 'awaiting review', live: false, objects: layoutObjects(), submittedBy: flag.organizerId, submittedAt: parseColombo('2027-02-12T14:40') });

  /* Orders */
  const mk = async (o: { code: string; who: string; email: string; kind: 'tier' | 'table'; qty: number; table?: string; status: string; pay: string; counted: boolean; userId?: Types.ObjectId | null; holdId?: Types.ObjectId; source?: string }) => {
    const table = o.table ? (o.table.startsWith('G') ? 'gold' : 'platinum') : null;
    const unit = table ? VIP[table].minSpendCents : p3.priceCents, qty = table ? 1 : o.qty;
    const subtotal = unit * qty, fee = Math.round(subtotal * 0.05 / 100) * 100;
    const label = table ? `Table ${o.table} · ${VIP[table].name}` : `${o.qty} × Phase 3`;
    return Order.create({
      code: o.code, eventId: flag._id, buyer: { name: o.who, email: o.email, mobile: '0771234567' }, userId: o.userId ?? null,
      lines: [{ kind: o.kind, tierId: table ? null : p3._id, tableId: o.table ? tables.get(o.table) : null, tableCode: o.table ?? null, label, qty, unitCents: unit, seats: table ? VIP[table].seats : undefined }],
      line: label, qty, admits: table ? VIP[table].seats : o.qty, subtotalCents: subtotal, feePercent: 5, feeCents: fee, totalCents: subtotal + fee,
      payMethod: o.pay, status: o.status, counted: o.counted, paidAt: o.status === 'paid' || o.status === 'refunded' ? before : undefined, holdId: o.holdId ?? null,
      source: o.source ?? null, viewTokenHash: sha256(randomToken()), notifiedAt: before, marketingConsent: true,
    });
  };
  const fan = (n: string) => fans.get(n)?._id ?? null;
  const paidOrders = [
    await mk({ code: 'VOID-2701842', who: 'Sanduni Wijesinghe', email: FANS[0].email, kind: 'tier', qty: 2, status: 'paid', pay: 'card', counted: true, userId: fan('Sanduni Wijesinghe'), source: 'ig-launch' }),
    await mk({ code: 'VOID-2701840', who: 'Ishara Gunawardena', email: FANS[2].email, kind: 'table', qty: 1, table: 'P02', status: 'paid', pay: 'koko', counted: true, userId: fan('Ishara Gunawardena') }),
    await mk({ code: 'VOID-2701839', who: 'Dinesh Abeysekara', email: 'dinesh.a@example.com', kind: 'tier', qty: 1, status: 'paid', pay: 'card', counted: true }),
    await mk({ code: 'VOID-2701838', who: 'Nethmi Jayawardena', email: FANS[3].email, kind: 'tier', qty: 6, status: 'paid', pay: 'card', counted: true, userId: fan('Nethmi Jayawardena'), source: 'wa-community' }),
    await mk({ code: 'VOID-2701822', who: 'Ruwan Senanayake', email: 'ruwan.s@example.com', kind: 'tier', qty: 3, status: 'paid', pay: 'koko', counted: true }),
    await mk({ code: 'VOID-2701795', who: 'Hiruni De Alwis', email: 'hiruni.d@example.com', kind: 'tier', qty: 2, status: 'paid', pay: 'koko', counted: true }),
  ];
  for (const o of paidOrders) {
    await tx(async (s) => issueTicketsIn(o.toObject() as never, s));
    await Payment.create({ orderId: o._id, provider: o.payMethod === 'koko' ? 'koko' : 'payhere', providerPaymentId: `SEED-${o.code}`, providerOrderId: o.code, amountCents: o.totalCents, status: 'success', method: o.payMethod === 'koko' ? 'KOKO' : 'VISA', verifiedAt: before, processedAt: before });
  }
  /* VOID-2701839 was refunded: tickets void. */
  const refunded = paidOrders[2];
  await Order.updateOne({ _id: refunded._id }, { $set: { status: 'refunded', refundedCents: refunded.totalCents } });
  await Ticket.updateMany({ orderId: refunded._id }, { $set: { status: 'void', voidReason: 'refunded' } });
  await Payment.updateOne({ orderId: refunded._id }, { $set: { status: 'refunded', refundedAt: before, refundRef: 'SEED-REFUND', refundAmountCents: refunded.totalCents } });
  await KokoPlan.create([
    { orderId: paidOrders[1]._id, kokoRef: 'KOKO-SEED-1840', amountCents: paidOrders[1].totalCents, received: 1, status: 'active' },
    { orderId: paidOrders[4]._id, kokoRef: 'KOKO-SEED-1822', amountCents: paidOrders[4].totalCents, received: 2, status: 'active' },
    { orderId: paidOrders[5]._id, kokoRef: 'KOKO-SEED-1795', amountCents: paidOrders[5].totalCents, received: 3, status: 'completed' },
  ]);

  /* Split groups SP-036 to SP-038 */
  const g037hold = new Types.ObjectId();
  const splits = [
    { group: 'SP-038', code: 'VOID-2701841', who: 'Kavindu Rathnayake', email: FANS[1].email, qty: 4, size: 4, paid: 2, hours: 31, userId: fan('Kavindu Rathnayake') },
    { group: 'SP-037', code: 'VOID-2701837', who: 'Tharaka Bandara', email: 'tharaka.b@example.com', qty: 1, table: 'G06', size: 6, paid: 4, hours: 5 },
    { group: 'SP-036', code: 'VOID-2701836', who: 'Malsha Peiris', email: 'malsha.p@example.com', qty: 3, size: 3, paid: 1, hours: 19 },
  ];
  for (const s of splits) {
    const expiresAt = new Date(now.getTime() + s.hours * 3_600_000);
    const o = await mk({ code: s.code, who: s.who, email: s.email, kind: s.table ? 'table' : 'tier', qty: s.qty, table: s.table, status: 'split pending', pay: 'split', counted: !s.table, userId: s.userId ?? null, holdId: s.table ? g037hold : undefined });
    if (s.table) {
      await Hold.create({ _id: g037hold, eventId: flag._id, kind: 'table', tableId: tables.get(s.table), tableCode: s.table, qty: 1, unitCents: o.lines[0].unitCents, label: o.line, secretHash: sha256(randomToken()), expiresAt, status: 'active', orderId: o._id });
      await Table.updateOne({ _id: tables.get(s.table) }, { $set: { status: 'held', holdId: g037hold } });
    }
    const m = splitShares(o.totalCents, s.size);
    const g = await SplitGroup.create({ code: s.group, orderId: o._id, eventId: flag._id, leadUserId: s.userId ?? null, leadName: s.who, size: s.size, shareCents: m.shareCents, leadShareCents: m.leadShareCents, expiresAt, status: 'open' });
    await Order.updateOne({ _id: o._id }, { $set: { splitGroupId: g._id } });
    for (let i = 0; i < s.size; i++) {
      const _id = new Types.ObjectId();
      const paid = i < s.paid;
      const sh = await SplitShare.create({ _id, groupId: g._id, orderId: o._id, index: i, amountCents: i === 0 ? m.leadShareCents : m.shareCents, status: paid ? 'paid' : 'waiting', name: i === 0 ? s.who : `Friend ${i}`, email: i === 0 ? s.email : null, tokenHash: i === 0 ? null : sha256(shareToken(_id)), paidAt: paid ? before : undefined });
      if (paid) {
        const p = await Payment.create({ orderId: o._id, splitShareId: sh._id, provider: 'payhere', providerPaymentId: `SEED-${s.code}-S${i}`, providerOrderId: `${s.code}-S${i}`, amountCents: sh.amountCents, status: 'success', method: 'VISA', verifiedAt: before, processedAt: before });
        await SplitShare.updateOne({ _id: sh._id }, { $set: { paymentId: p._id } });
      }
    }
  }
  /* P05: someone is in checkout right now. The hold lapses in 10 minutes like any other. */
  const p05hold = new Types.ObjectId();
  await Hold.create({ _id: p05hold, eventId: flag._id, kind: 'table', tableId: tables.get('P05'), tableCode: 'P05', qty: 1, unitCents: VIP.platinum.minSpendCents, label: 'Table P05 · Platinum', secretHash: sha256(randomToken()), expiresAt: new Date(now.getTime() + 10 * 60_000), status: 'active' });
  await Table.updateOne({ _id: tables.get('P05') }, { $set: { status: 'held', holdId: p05hold } });

  /* Backdate the sample orders so the charts read them as part of the imported baseline. */
  await Order.collection.updateMany({}, { $set: { createdAt: before } });
  await Event.collection.updateMany({}, { $set: { createdAt: now } });

  /* Gate staff */
  for (const s of STAFF) {
    const u = await User.create({ name: s.name, email: `${slug(s.name).replace(/-/g, '.')}@staff.example.com`, phone: s.mobile, passwordHash: pw, role: 'gate', assignedEventId: flag._id });
    await GateStaff.create({ eventId: flag._id, userId: u._id, name: s.name, mobile: s.mobile, role: s.role, gateAccess: s.gate, boxOffice: s.box, lastSeenAt: s.online ? now : null });
    if (s.role === 'gate lead') accounts.push({ role: 'gate', email: u.email, password: DEMO_PASSWORD, note: 'scanner and box office' });
  }

  for (const l of LINKS) await Campaign.create({ eventId: flag._id, ...l, revenueCents: l.sales * p3.priceCents });

  for (const i of INVOICES) await Invoice.create({ eventId: flag._id, number: i.number, billTo: i.billTo, description: i.description, amountCents: R(i.amount), issuedAt: parseColombo(i.issued), dueAt: i.due === 'today' ? parseColombo(`${colomboDayKey(now)}T17:00`) : parseColombo(i.due), status: i.status });

  for (const p of PAYOUTS) {
    const e = events[p.e];
    await Payout.create({ eventId: e._id, code: p.code, amountCents: R(p.amount), scheduledFor: parseColombo(p.date), status: p.status, bankRef: 'ref' in p ? p.ref : null, bankAccount: e.payoutAccount, approvedBy: p.status === 'paid' ? superAdmin._id : undefined, approvedAt: p.status === 'paid' ? parseColombo(p.date) : undefined, paidAt: p.status === 'paid' ? parseColombo(p.date) : undefined });
  }

  for (const a of AUDIT) await AuditLog.create({ at: new Date(a.at), actorLabel: a.who, action: a.action, target: a.target, result: a.result });

  /* Sequences carry on where the prototype stopped. */
  await Counter.create([{ _id: 'order', seq: 1842 }, { _id: 'split', seq: 38 }, { _id: 'invoice', seq: 27 }, { _id: 'payout', seq: 2704 }]);

  for (const e of events) await ensureEventKey(e._id);
  return { accounts, flagshipId: String(flag._id) };
};

