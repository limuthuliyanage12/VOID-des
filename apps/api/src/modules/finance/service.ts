/*
 * Dashboard, analytics, finance and payouts.
 * Organizer net = gross − platform fees − refunds. A 1.2% refund reserve is held until 30 days after the event.
 * Payout approval records the decision and produces a bank file; it never moves money by itself.
 * Charts combine the imported prototype baseline with live paid orders since.
 */
import { Types } from 'mongoose';
import { colomboDayKey, formatDate, formatLKR, RULES } from '@void/shared';
import { Event, Invoice, KokoPlan, Order, Payout, SplitGroup, Table, Tier, type EventDoc, type OrderDoc } from '../../db/models/index.js';
import { toCsv, rupeesCell } from '../../lib/csv.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit, getSettings, nextPayoutCode, SYSTEM, type Actor } from '../../lib/platform.js';
import { leftOf } from '../tiers/inventory.js';

const oid = (id: string) => new Types.ObjectId(id);
const reserveOf = async (grossCents: number) => Math.round((grossCents * (await getSettings()).refundReservePercent) / 100 / 100) * 100;

export const money = async (e: Pick<EventDoc, 'stats'>) => {
  const gross = e.stats?.grossCents ?? 0, fees = e.stats?.feesCents ?? 0, refunds = e.stats?.refundsCents ?? 0;
  return { grossCents: gross, feesCents: fees, refundsCents: refunds, netCents: gross - fees - refunds, reserveCents: await reserveOf(gross) };
};

const liveOrders = (eventId: string) => Order.find({ eventId, status: { $in: ['paid', 'partially refunded'] }, payMethod: { $ne: 'comp' } }).lean<OrderDoc[]>();

export const summary = async (eventId: string) => {
  const e = await Event.findById(eventId).lean<EventDoc>();
  if (!e) throw notFound('Event');
  const [tiers, tables, recent, splitsSoon, invoicesDue, m, layoutPending] = await Promise.all([
    Tier.find({ eventId }).sort({ order: 1 }).lean(),
    Table.find({ eventId }).lean(),
    Order.find({ eventId }).sort({ createdAt: -1 }).limit(6).lean<OrderDoc[]>(),
    SplitGroup.countDocuments({ eventId, status: 'open', expiresAt: { $ne: null, $lte: new Date(Date.now() + RULES.splitWarnHours * 3_600_000) } }),
    Invoice.countDocuments({ eventId, status: 'pending', dueAt: { $lte: new Date(Date.now() + 86_400_000) } }),
    money(e),
    import('../../db/models/index.js').then(({ Layout }) => Layout.exists({ eventId, status: { $in: ['draft', 'changes requested'] }, live: false })),
  ]);
  const live = tiers.find((t) => t.state === 'on sale');
  const reserved = tables.filter((t) => t.status === 'reserved');
  const alerts = [
    live && { kind: 'tier', text: `${leftOf(live)} tickets left on ${live.name}` },
    splitsSoon && { kind: 'split', text: `${splitsSoon} split groups expire within 6 hours` },
    invoicesDue && { kind: 'invoice', text: `${invoicesDue} invoice${invoicesDue > 1 ? 's' : ''} due today` },
    layoutPending && { kind: 'layout', text: 'Layout changes are not published' },
  ].filter(Boolean);
  const refundRate = e.stats.grossCents ? Math.round((e.stats.refundsCents / e.stats.grossCents) * 1000) / 10 : 0;
  return {
    event: { id: String(e._id), name: e.name, startsAt: e.startsAt, capacity: e.capacity },
    finding: live ? `${live.name} has ${leftOf(live)} left` : `${e.stats.sold} of ${e.capacity} sold`,
    kpis: {
      sold: e.stats.sold, capacity: e.capacity, grossCents: e.stats.grossCents, orders: e.stats.orders,
      tablesReserved: reserved.length, tablesTotal: tables.length, tablesGold: reserved.filter((t) => t.tier === 'gold').length, tablesPlatinum: reserved.filter((t) => t.tier === 'platinum').length,
      refundRatePercent: refundRate, feesCents: m.feesCents, refundsCents: m.refundsCents, netCents: m.netCents, reserveCents: m.reserveCents,
    },
    ladder: tiers.map((t) => ({ id: String(t._id), name: t.name, priceCents: t.priceCents, total: t.total, sold: t.sold, left: leftOf(t), state: t.state })),
    weekly: await weekly(eventId, e), channels: await channels(eventId, e), alerts,
    recentOrders: recent.map((o) => ({ code: o.code, who: o.buyer.name, item: o.line, qty: o.qty, partyPass: o.qty > RULES.partyPassOver || o.lines[0]?.kind === 'table', amountCents: o.totalCents, status: o.status, payMethod: o.payMethod })),
    inventory: tiers.map((t) => ({ name: t.name, left: leftOf(t), total: t.total })),
  };
};

/** Tickets per Colombo week (Friday-dated buckets, like the prototype), baseline plus live orders not yet in it. */
export const weekly = async (eventId: string, e?: EventDoc | null) => {
  e ??= await Event.findById(eventId).lean<EventDoc>();
  const base = (e?.baseline?.weekly ?? []).map((w) => ({ week: w.week ?? '', tickets: w.tickets ?? 0, note: w.note ?? null }));
  const since = e?.baseline?.weekly?.length ? new Date(e.createdAt as unknown as Date) : new Date(0);
  const live = await Order.aggregate<{ _id: string; n: number }>([
    { $match: { eventId: oid(eventId), status: { $in: ['paid', 'partially refunded'] }, paidAt: { $gte: since }, 'lines.kind': { $ne: 'table' } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$paidAt', unit: 'week', timezone: 'Asia/Colombo' } }, timezone: 'Asia/Colombo' } }, n: { $sum: '$qty' } } }, { $sort: { _id: 1 } },
  ]);
  return [...base, ...live.map((l) => ({ week: formatDate(new Date(`${l._id}T00:00:00+05:30`)).replace(/ \d{4}$/, ''), tickets: l.n, note: null }))];
};

export const channels = async (eventId: string, e?: EventDoc | null) => {
  e ??= await Event.findById(eventId).lean<EventDoc>();
  const m = new Map<string, number>((e?.baseline?.channels ?? []).map((c) => [c.name ?? '', c.tickets ?? 0]));
  const { Campaign } = await import('../../db/models/index.js');
  const names = new Map((await Campaign.find({ eventId }).lean()).map((c) => [c.ref, c.name]));
  for (const o of await liveOrders(eventId)) {
    if (o.lines[0]?.kind === 'table' || (e && o.createdAt < e.createdAt)) continue;
    const n = o.source ? (/^ig|insta/.test(o.source) ? 'Instagram' : /^wa|whatsapp/.test(o.source) ? 'WhatsApp' : /^promo/.test(o.source) ? 'Promoter links' : names.get(o.source) ?? 'Promoter links') : 'Direct';
    m.set(n, (m.get(n) ?? 0) + o.qty);
  }
  return [...m].map(([name, tickets]) => ({ name, tickets }));
};

export const payments = async (eventId: string, e?: EventDoc | null) => {
  e ??= await Event.findById(eventId).lean<EventDoc>();
  const label = { card: 'Card', koko: 'Koko', split: 'Split pay', cash: 'Box office' } as Record<string, string>;
  const m = new Map<string, number>((e?.baseline?.payments ?? []).map((p) => [p.method ?? '', p.amountCents ?? 0]));
  for (const o of await liveOrders(eventId)) { if (e && o.createdAt < e.createdAt) continue; const k = label[o.payMethod] ?? o.payMethod; m.set(k, (m.get(k) ?? 0) + o.totalCents); }
  return [...m].map(([method, amountCents]) => ({ method, amountCents }));
};

export const analytics = async (eventId: string) => {
  const e = await Event.findById(eventId).lean<EventDoc>();
  if (!e) throw notFound('Event');
  const [w, c, p, tiers] = await Promise.all([weekly(eventId, e), channels(eventId, e), payments(eventId, e), Tier.find({ eventId }).sort({ order: 1 }).lean()]);
  const onSale = tiers.filter((t) => t.state !== 'scheduled').reduce((n, t) => n + t.total, 0) - (tiers.find((t) => t.name === 'Gate')?.total ?? 0);
  let run = 0; const running = w.map((x) => ({ week: x.week, total: (run += x.tickets) }));
  const recent = w.slice(-3, -1), pace = recent.length ? recent.reduce((n, x) => n + x.tickets, 0) / recent.length : 0;
  const best = w.reduce((b, x) => (x.tickets > b.tickets ? x : b), { week: '', tickets: 0 });
  return {
    kpis: { grossCents: e.stats.grossCents, ticketGrossCents: e.stats.ticketGrossCents, tableGrossCents: e.stats.tableGrossCents, avgTicketCents: e.stats.sold ? Math.round(e.stats.ticketGrossCents / e.stats.sold) : 0, avgOrderCents: e.stats.orders ? Math.round(e.stats.grossCents / e.stats.orders) : 0, sellThroughPercent: e.capacity ? Math.round((e.stats.sold / e.capacity) * 1000) / 10 : 0, bestWeek: best },
    weekly: w, revenueByTier: tiers.map((t) => ({ name: t.name, revenueCents: t.sold * t.priceCents, sold: t.sold })),
    running, projection: { onSale, weeklyPace: Math.round(pace), projectedByEvent: Math.min(onSale, run + Math.round(pace * 1)) },
    channels: c, payments: p,
  };
};

export const reportCsv = async (eventId: string) => {
  const e = await Event.findById(eventId).lean<EventDoc>();
  if (!e) throw notFound('Event');
  const m = await money(e), c = await channels(eventId, e);
  const rows: [string, string | number][] = [['Tickets sold', e.stats.sold], ['Capacity', e.capacity], ['Orders', e.stats.orders], ['Gross (LKR)', rupeesCell(m.grossCents)], ['Platform fees (LKR)', rupeesCell(m.feesCents)], ['Refunds (LKR)', rupeesCell(m.refundsCents)], ['Net (LKR)', rupeesCell(m.netCents)], ...c.map((x) => [`Tickets via ${x.name}`, x.tickets] as [string, number])];
  return toCsv(rows.map(([k, v]) => ({ k, v })), [{ key: 'k', label: 'Metric' }, { key: 'v', label: 'Value' }]);
};

/* ---------- Finance and payouts ---------- */
const payoutView = (p: InstanceType<typeof Payout> | Record<string, unknown>) => {
  const x = p as { code: string; eventId: Types.ObjectId; kind: string; amountCents: number; scheduledFor: Date; status: string; bankRef: string | null; approvedAt?: Date; paidAt?: Date; bankAccount?: { bank?: string; last4?: string } };
  return { code: x.code, eventId: String(x.eventId), kind: x.kind, amountCents: x.amountCents, scheduledFor: x.scheduledFor, date: formatDate(x.scheduledFor), status: x.status, bankRef: x.bankRef, approvedAt: x.approvedAt ?? null, paidAt: x.paidAt ?? null, bankAccount: x.bankAccount ?? null };
};

export const finance = async (eventId: string) => {
  const e = await Event.findById(eventId).lean<EventDoc>();
  if (!e) throw notFound('Event');
  const [m, ps, p, inv] = await Promise.all([money(e), Payout.find({ eventId }).sort({ scheduledFor: -1 }).lean(), payments(eventId, e), Invoice.find({ eventId }).lean()]);
  const next = ps.filter((x) => x.status !== 'paid').sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())[0];
  const reserveRelease = new Date(e.endsAt.getTime() + RULES.reserveReleaseDays * 86_400_000);
  return {
    nextPayout: next ? { ...payoutView(next), line: `${formatLKR(next.amountCents)} on ${formatDate(next.scheduledFor)} to ${e.payoutAccount?.bank ?? 'your bank'} •••• ${e.payoutAccount?.last4 ?? '0000'}` } : null,
    kpis: { ...m, feePercent: (await getSettings()).bookingFeePercent },
    payouts: ps.map(payoutView), reserve: { amountCents: m.reserveCents, status: 'Held', releaseOn: reserveRelease, date: formatDate(reserveRelease) },
    payments: p, invoices: { count: inv.length, pendingCents: inv.filter((i) => i.status === 'pending').reduce((n, i) => n + i.amountCents, 0), paidCents: inv.filter((i) => i.status === 'paid').reduce((n, i) => n + i.amountCents, 0) },
  };
};

export const statementCsv = async (eventId: string, code?: string) => {
  const e = await Event.findById(eventId).lean<EventDoc>();
  if (!e) throw notFound('Event');
  const m = await money(e);
  const ps = await Payout.find({ eventId, ...(code ? { code } : {}) }).sort({ scheduledFor: 1 }).lean();
  if (code && !ps.length) throw notFound('Payout');
  const rows = [{ l: 'Gross', a: rupeesCell(m.grossCents) }, { l: 'Platform fees', a: -rupeesCell(m.feesCents) }, { l: 'Refunds', a: -rupeesCell(m.refundsCents) }, { l: 'Net', a: rupeesCell(m.netCents) }, { l: `Refund reserve (${(await getSettings()).refundReservePercent}%, held)`, a: -rupeesCell(m.reserveCents) }, ...ps.map((p) => ({ l: `Payout ${p.code} (${formatDate(p.scheduledFor)}, ${p.status})`, a: rupeesCell(p.amountCents) }))];
  return toCsv(rows, [{ key: 'l', label: 'Line' }, { key: 'a', label: 'Amount (LKR)' }]);
};

export const listKoko = async (eventId: string) => {
  const orders = await Order.find({ eventId, payMethod: 'koko' }, { code: 1, buyer: 1, totalCents: 1 }).lean<OrderDoc[]>();
  const plans = new Map((await KokoPlan.find({ orderId: { $in: orders.map((o) => o._id) } }).lean()).map((p) => [String(p.orderId), p]));
  const e = await Event.findById(eventId, { baseline: 1, createdAt: 1 }).lean<EventDoc>();
  const live = await Order.countDocuments({ eventId, payMethod: 'koko', status: 'paid', createdAt: { $gte: e?.createdAt ?? new Date(0) } });
  return { count: (e?.baseline?.kokoOrders ?? 0) + live, rows: orders.map((o) => { const p = plans.get(String(o._id)); return { code: o.code, who: o.buyer.name, totalCents: o.totalCents, instalments: p?.instalments ?? 3, received: p?.received ?? 0, status: p?.status ?? 'pending approval' }; }) };
};

/* ---------- Super admin ---------- */
export const listPayouts = async () => {
  const ps = await Payout.find().sort({ scheduledFor: -1, code: -1 }).lean();
  const names = new Map((await Event.find({}, { name: 1 }).lean()).map((e) => [String(e._id), e.name]));
  const rows = ps.map((p) => ({ ...payoutView(p), event: names.get(String(p.eventId)) ?? '' }));
  const waiting = rows.filter((r) => r.status === 'awaiting approval');
  return { awaiting: waiting, approved: rows.filter((r) => r.status === 'approved'), paid: rows.filter((r) => r.status === 'paid'), finding: { batches: waiting.length, amountCents: waiting.reduce((n, r) => n + r.amountCents, 0) } };
};

export const approvePayout = async (code: string, actor: Actor) => {
  const p = await Payout.findOne({ code });
  if (!p) throw notFound('Payout');
  if (p.status !== 'awaiting approval') throw conflict(`This batch is ${p.status}`);
  const e = await Event.findById(p.eventId, { name: 1, payoutAccount: 1 }).lean<EventDoc>();
  const bankFile = toCsv([{ ref: p.code, payee: e?.name ?? '', bank: e?.payoutAccount?.bank ?? '', acct: `****${e?.payoutAccount?.last4 ?? ''}`, amount: (p.amountCents / 100).toFixed(2), currency: 'LKR', date: colomboDayKey(p.scheduledFor) }], [{ key: 'ref', label: 'Reference' }, { key: 'payee', label: 'Payee' }, { key: 'bank', label: 'Bank' }, { key: 'acct', label: 'Account' }, { key: 'amount', label: 'Amount' }, { key: 'currency', label: 'Currency' }, { key: 'date', label: 'Value date' }]);
  const done = await Payout.findOneAndUpdate({ _id: p._id, status: 'awaiting approval' }, { $set: { status: 'approved', approvedBy: actor.id, approvedAt: new Date(), bankFile } }, { new: true });
  if (!done) throw conflict('This batch changed. Refresh and try again.');
  await audit(actor, 'Approved payout', p.code, { eventId: p.eventId, result: 'Approved', after: { amountCents: p.amountCents } });
  return { ...payoutView(done), bankFile };
};

export const markPayoutPaid = async (code: string, bankRef: string, actor: Actor) => {
  const p = await Payout.findOneAndUpdate({ code, status: 'approved' }, { $set: { status: 'paid', bankRef, paidAt: new Date() } }, { new: true });
  if (!p) throw conflict('Only an approved batch can be marked paid');
  await audit(actor, 'Marked payout paid', code, { eventId: p.eventId, result: 'Paid', after: { bankRef } });
  return payoutView(p);
};

/** preparePayouts job: one batch per live event with unpaid net, less the reserve and what is already batched. */
export const preparePayouts = async () => {
  const events = await Event.find({ status: { $in: ['live', 'sold out', 'suspended'] } }).lean<EventDoc[]>();
  let made = 0;
  for (const e of events) {
    const m = await money(e);
    const batched = (await Payout.find({ eventId: e._id, kind: 'regular' }).lean()).reduce((n, p) => n + p.amountCents, 0);
    const due = m.netCents - m.reserveCents - batched;
    if (due < 100_000 || (await Payout.exists({ eventId: e._id, status: 'awaiting approval' }))) continue;
    await Payout.create({ eventId: e._id, code: await nextPayoutCode(), amountCents: due, grossCents: m.grossCents, feesCents: m.feesCents, refundsCents: m.refundsCents, reserveCents: m.reserveCents, scheduledFor: new Date(Date.now() + 3 * 86_400_000), bankAccount: e.payoutAccount });
    made++;
  }
  if (made) await audit(SYSTEM, 'Prepared payout batches', `${made} batches`, { result: 'Awaiting approval' });
  return made;
};

/** releaseReserve job: 30 days after an event, the reserve joins a final payout. */
export const releaseReserve = async () => {
  const cutoff = new Date(Date.now() - RULES.reserveReleaseDays * 86_400_000);
  const events = await Event.find({ endsAt: { $lte: cutoff } }).lean<EventDoc[]>();
  for (const e of events) {
    if (await Payout.exists({ eventId: e._id, kind: 'reserve release' })) continue;
    const m = await money(e);
    if (m.reserveCents <= 0) continue;
    await Payout.create({ eventId: e._id, code: await nextPayoutCode(), kind: 'reserve release', amountCents: m.reserveCents, reserveCents: m.reserveCents, scheduledFor: new Date(), bankAccount: e.payoutAccount });
    await audit(SYSTEM, 'Released refund reserve', e.name, { eventId: e._id, result: 'Awaiting approval', after: { amountCents: m.reserveCents } });
  }
};

export const revenue = async () => {
  const es = await Event.find({ status: { $nin: ['draft', 'rejected'] } }).lean<EventDoc[]>();
  const sum = (f: (e: EventDoc) => number) => es.reduce((n, e) => n + f(e), 0);
  const gross = sum((e) => e.stats.grossCents), fees = sum((e) => e.stats.feesCents), refunds = sum((e) => e.stats.refundsCents);
  const by = (k: 'region' | 'genre') => Object.entries(es.reduce<Record<string, number>>((m, e) => ({ ...m, [e[k]]: (m[e[k]] ?? 0) + e.stats.grossCents }), {})).map(([name, grossCents]) => ({ name, grossCents })).sort((a, b) => b.grossCents - a.grossCents);
  const flagship = es.sort((a, b) => b.stats.grossCents - a.stats.grossCents)[0];
  return {
    kpis: { grossCents: gross, feesCents: fees, refundsCents: refunds, organizerNetCents: gross - fees - refunds, ticketsSold: sum((e) => e.stats.sold), eventsLive: es.filter((e) => e.status === 'live').length },
    split: { organizerNetCents: gross - fees - refunds, feesCents: fees, refundsCents: refunds },
    weekly: flagship ? await weekly(String(flagship._id), flagship) : [],
    byGenre: by('genre'), byRegion: by('region'),
    byEvent: es.map((e) => ({ id: String(e._id), name: e.name, grossCents: e.stats.grossCents, sold: e.stats.sold, capacity: e.capacity, sellThroughPercent: e.capacity ? Math.round((e.stats.sold / e.capacity) * 1000) / 10 : 0, feesCents: e.stats.feesCents, refundsCents: e.stats.refundsCents, netCents: e.stats.grossCents - e.stats.feesCents - e.stats.refundsCents })).sort((a, b) => b.grossCents - a.grossCents),
  };
};

export const revenueCsv = async () => {
  const r = await revenue();
  return toCsv([...r.byEvent, { name: 'Total', grossCents: r.kpis.grossCents, feesCents: r.kpis.feesCents, refundsCents: r.kpis.refundsCents, netCents: r.kpis.organizerNetCents, sold: r.kpis.ticketsSold } as never], [
    { key: 'name', label: 'Event' }, { key: (x: { sold: number }) => x.sold, label: 'Tickets' }, { key: (x: { grossCents: number }) => rupeesCell(x.grossCents), label: 'Gross (LKR)' },
    { key: (x: { feesCents: number }) => rupeesCell(x.feesCents), label: 'Fees (LKR)' }, { key: (x: { refundsCents: number }) => rupeesCell(x.refundsCents), label: 'Refunds (LKR)' }, { key: (x: { netCents: number }) => rupeesCell(x.netCents), label: 'Organizer net (LKR)' },
  ]);
};
