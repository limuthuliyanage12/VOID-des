/*
 * Gate scanning. The scanner can verify a QR's signature offline with the event's public keys,
 * but only the server decides "already used": the unique index on admitted scans makes a second admit fail.
 * Offline scans sync later with their own timestamps. If two devices admitted one ticket offline,
 * the earliest scan stays admitted and the later one is flagged as a duplicate for the gate lead.
 */
import { Types } from 'mongoose';
import { calcOrder, formatTime, type ScanView } from '@void/shared';
import { tx } from '../../db/connect.js';
import { Event, GateStaff, Hold, Order, Scan, Ticket, Tier, User, type TicketDoc } from '../../db/models/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { conflict, isDupKey, notFound } from '../../lib/errors.js';
import { audit, getSettings, nextOrderCode, type Actor } from '../../lib/platform.js';
import { emit } from '../../lib/realtime.js';
import { eventPublicKeys, peekToken, verifyToken } from '../../lib/qr.js';
import { emitInventory } from '../holds/service.js';
import { fulfilIn } from '../orders/fulfil.js';
import { reserveTier } from '../tiers/inventory.js';

const keyCache = new Map<string, { at: number; keys: Record<number, string> }>();
const keysFor = async (eventId: string) => {
  const c = keyCache.get(eventId);
  if (c && Date.now() - c.at < 60_000) return c.keys;
  const keys = await eventPublicKeys(eventId);
  keyCache.set(eventId, { at: Date.now(), keys });
  return keys;
};

interface ScanIn { token: string; deviceId: string; gate?: string; scannedAt?: Date }

export const scan = async (eventId: string, staffId: string, s: ScanIn, offline = false): Promise<ScanView> => {
  const at = s.scannedAt ?? new Date();
  const base = { eventId, staffId, deviceId: s.deviceId, gate: s.gate, scannedAt: at, syncedAt: offline ? new Date() : null };
  const reply = (result: ScanView['result'], message: string, t?: TicketDoc): ScanView => ({ result, message, at: at.toISOString(), ...(t ? { holderName: t.holderName, line: t.line, admits: t.admits } : {}) });
  const record = async (result: ScanView['result'], message: string, t?: TicketDoc, extra: Record<string, unknown> = {}) => {
    await Scan.create({ ...base, ticketId: t?._id ?? null, result, admits: result === 'admitted' ? t?.admits ?? 0 : 0, note: message, ...extra });
    return reply(result, message, t);
  };
  void GateStaff.updateOne({ eventId, userId: staffId }, { $set: { lastSeenAt: new Date() } });

  const peek = peekToken(s.token);
  if (!peek) return record('invalid', 'This is not a VOID ticket');
  if (peek.e !== eventId) return record('wrong event', 'This ticket is for a different event');
  const p = verifyToken(s.token, await keysFor(eventId));
  if (!p) return record('invalid', 'The QR signature does not check out');
  const t = Types.ObjectId.isValid(p.t) ? await Ticket.findById(p.t).lean<TicketDoc>() : null;
  if (!t || String(t.eventId) !== eventId) return record('invalid', 'No ticket matches this QR');
  if (t.status === 'void') return record('invalid', 'This ticket was refunded or cancelled', t);
  if (t.status === 'transferred' || p.q !== (t.qrSecretVersion ?? 1)) return record('invalid', 'This QR was replaced by a transfer', t);

  try {
    await Scan.create({ ...base, ticketId: t._id, result: 'admitted', admits: t.admits });
  } catch (e) {
    if (!isDupKey(e)) throw e;
    const first = await Scan.findOne({ ticketId: t._id, result: 'admitted' }).lean();
    /* Both offline and this one is earlier: the earlier scan wins, the other is flagged. */
    if (offline && first?.syncedAt && at < first.scannedAt) {
      const swapped = await tx(async (session) => {
        const moved = await Scan.updateOne({ _id: first._id, result: 'admitted' }, { $set: { result: 'duplicate', flagged: true, admits: 0, note: 'Admitted later on another device while offline' } }, { session });
        if (!moved.modifiedCount) return false;
        await Scan.create([{ ...base, ticketId: t._id, result: 'admitted', admits: t.admits }], { session });
        return true;
      }).catch(() => false);
      if (swapped) { await Ticket.updateOne({ _id: t._id }, { $set: { usedAt: at, gate: s.gate } }); void emitStats(eventId); return reply('admitted', `Admit ${t.admits}`, t); }
    }
    return record('duplicate', first ? `Already admitted at ${formatTime(first.scannedAt)}${first.gate ? ` at ${first.gate}` : ''}` : 'Already admitted', t, { flagged: offline });
  }
  await Ticket.updateOne({ _id: t._id, status: 'valid' }, { $set: { status: 'used', usedAt: at, gate: s.gate } });
  void emitStats(eventId);
  return reply('admitted', `Admit ${t.admits}`, t);
};

export const scanBatch = async (eventId: string, staffId: string, scans: (ScanIn & { scannedAt: Date })[]) => {
  const sorted = [...scans].sort((a, b) => a.scannedAt.getTime() - b.scannedAt.getTime());
  const results = [];
  for (const s of sorted) results.push({ token: s.token.slice(0, 12) + '…', deviceId: s.deviceId, ...(await scan(eventId, staffId, s, true)) });
  return { results, admitted: results.filter((r) => r.result === 'admitted').length, duplicates: results.filter((r) => r.result === 'duplicate').length };
};

export const gateStats = async (eventId: string) => {
  const id = new Types.ObjectId(eventId);
  const [e, admitted, dup, issued, staff] = await Promise.all([
    Event.findById(eventId, { capacity: 1 }).lean<{ capacity: number }>(),
    Scan.aggregate<{ n: number }>([{ $match: { eventId: id, result: 'admitted' } }, { $group: { _id: null, n: { $sum: '$admits' } } }]),
    Scan.countDocuments({ eventId, result: 'duplicate' }),
    Ticket.aggregate<{ n: number }>([{ $match: { eventId: id, status: { $in: ['valid', 'used'] } } }, { $group: { _id: null, n: { $sum: '$admits' } } }]),
    GateStaff.find({ eventId }).lean(),
  ]);
  const online = staff.filter((s) => s.lastSeenAt && Date.now() - s.lastSeenAt.getTime() < 120_000).length;
  const last = await Scan.find({ eventId }).sort({ scannedAt: -1 }).limit(10).lean();
  return {
    checkedIn: admitted[0]?.n ?? 0, capacity: e?.capacity ?? 0, issued: issued[0]?.n ?? 0, staffOnline: online, staffTotal: staff.length, duplicatesBlocked: dup,
    flagged: await Scan.countDocuments({ eventId, flagged: true }),
    lastScans: last.map((s) => ({ result: s.result, at: s.scannedAt.toISOString(), gate: s.gate ?? null, note: s.note ?? '', flagged: s.flagged })),
  };
};

const emitStats = async (eventId: string) => emit(`gate.${eventId}`, 'stats', await gateStats(eventId));

/* ---------- Staff ---------- */
export const listStaff = async (eventId: string) => {
  const s = await GateStaff.find({ eventId }).sort({ createdAt: 1 }).lean();
  return s.map((x) => ({ id: String(x._id), userId: String(x.userId), name: x.name, mobile: x.mobile, role: x.role, gateAccess: x.gateAccess, boxOffice: x.boxOffice, online: !!x.lastSeenAt && Date.now() - x.lastSeenAt.getTime() < 120_000, lastSeenAt: x.lastSeenAt ?? null }));
};

export const addStaff = async (eventId: string, b: { name: string; mobile: string; email?: string; role: 'scanner' | 'box office' | 'gate lead' }, actor: Actor) => {
  const email = b.email ?? `gate-${b.mobile.replace(/\D/g, '')}@staff.eventsbythevoid.lk`;
  let u = await User.findOne({ email });
  if (u && (u.role !== 'gate' || String(u.assignedEventId) !== eventId)) throw conflict('That person already has an account with other access');
  const invite = randomToken(24);
  if (!u) u = await User.create({ name: b.name, email, phone: b.mobile, role: 'gate', assignedEventId: eventId, status: 'invited', invite: { tokenHash: sha256(invite), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  const s = await GateStaff.create({ eventId, userId: u._id, name: b.name, mobile: b.mobile, role: b.role, gateAccess: b.role !== 'box office', boxOffice: b.role !== 'scanner' });
  await audit(actor, 'Added gate staff', `${b.name} · ${b.role}`, { eventId });
  return { id: String(s._id), userId: String(u._id), inviteToken: invite };
};

export const patchStaff = async (eventId: string, b: { id: string; gateAccess?: boolean; boxOffice?: boolean; role?: string }, actor: Actor) => {
  const before = await GateStaff.findOne({ _id: b.id, eventId }).lean();
  if (!before) throw notFound('Staff member');
  const set: Record<string, unknown> = {};
  for (const k of ['gateAccess', 'boxOffice', 'role'] as const) if (b[k] !== undefined) set[k] = b[k];
  await GateStaff.updateOne({ _id: b.id, eventId }, { $set: set });
  await audit(actor, 'Changed gate access', before.name, { eventId, before: { gateAccess: before.gateAccess, boxOffice: before.boxOffice, role: before.role }, after: set });
  return { ok: true };
};

/** Box office sale at the gate: cash, paid on the spot, tickets issued at once. */
export const boxOfficeSale = async (eventId: string, b: { tierId: string; qty: number; name: string; email?: string; mobile?: string }, actor: Actor) => {
  const settings = await getSettings();
  const r = await tx(async (session) => {
    const tier = await Tier.findOne({ _id: b.tierId, eventId }, null, { session });
    if (!tier) throw notFound('Ticket tier');
    if (!(await reserveTier(tier._id, b.qty, session))) throw conflict(`Not enough left in ${tier.name}`, undefined, 'NOT_ENOUGH_LEFT');
    const maths = calcOrder({ qty: b.qty, unitCents: tier.priceCents, feePercent: settings.bookingFeePercent });
    const holdId = new Types.ObjectId();
    await Hold.create([{ _id: holdId, eventId, kind: 'tier', tierId: tier._id, qty: b.qty, unitCents: tier.priceCents, label: `${b.qty} × ${tier.name}`, secretHash: sha256(randomToken()), expiresAt: new Date(Date.now() + 600_000), status: 'active' }], { session });
    const [o] = await Order.create([{ code: await nextOrderCode(session), eventId, buyer: { name: b.name, email: b.email ?? 'boxoffice@eventsbythevoid.lk', mobile: b.mobile }, lines: [{ kind: 'box office', tierId: tier._id, label: `${b.qty} × ${tier.name}`, qty: b.qty, unitCents: tier.priceCents }], line: `${b.qty} × ${tier.name}`, qty: b.qty, admits: b.qty, ...maths, payMethod: 'cash', status: 'pending', holdId }], { session });
    await Hold.updateOne({ _id: holdId }, { $set: { orderId: o._id } }, { session });
    const f = await fulfilIn(o._id, session);
    if (!f.ok) throw conflict('The sale could not be completed');
    return o;
  });
  await audit(actor, 'Box office sale', r.code, { eventId, after: { qty: b.qty, totalCents: r.totalCents } });
  void emitInventory(eventId);
  const tickets = await Ticket.find({ orderId: r._id }).lean<TicketDoc[]>();
  return { code: r.code, totalCents: r.totalCents, tickets: tickets.map((t) => ({ id: String(t._id), line: t.line, admits: t.admits })) };
};
