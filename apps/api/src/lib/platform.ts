/* Settings singleton, human-readable sequence numbers and the append-only audit log. */
import type { ClientSession, Types } from 'mongoose';
import { AuditLog, Counter, Settings, type SettingsDoc } from '../db/models/index.js';

export const getSettings = async (session?: ClientSession): Promise<SettingsDoc> => {
  const s = await Settings.findOne({ key: 'platform' }, null, { session }).lean();
  if (s) return s as SettingsDoc;
  const created = await Settings.findOneAndUpdate({ key: 'platform' }, { $setOnInsert: { key: 'platform' } }, { upsert: true, new: true, session }).lean();
  return created as SettingsDoc;
};

/** Next number in a named sequence. Safe under concurrency. */
export const nextSeq = async (name: string, start: number, session?: ClientSession): Promise<number> => {
  const c = await Counter.findOneAndUpdate({ _id: name }, [{ $set: { seq: { $add: [{ $ifNull: ['$seq', start - 1] }, 1] } } }], { upsert: true, new: true, session });
  return c!.seq ?? start;
};

/** VOID-2701843 style. */
export const nextOrderCode = async (session?: ClientSession) => `VOID-27${String(await nextSeq('order', 1843, session)).padStart(5, '0')}`;
export const nextSplitCode = async (session?: ClientSession) => `SP-${String(await nextSeq('split', 39, session)).padStart(3, '0')}`;
export const nextInvoiceNumber = async (session?: ClientSession) => `INV-${String(await nextSeq('invoice', 28, session)).padStart(3, '0')}`;
export const nextPayoutCode = async (session?: ClientSession) => `PB-${await nextSeq('payout', 2705, session)}`;

export interface Actor { id?: Types.ObjectId | string | null; label: string }
export const SYSTEM: Actor = { id: null, label: 'System' };

export const audit = async (
  actor: Actor,
  action: string,
  target: string,
  opts: { result?: string; before?: unknown; after?: unknown; eventId?: Types.ObjectId | string | null; session?: ClientSession } = {},
) => {
  await AuditLog.create([{ actorId: actor.id ?? null, actorLabel: actor.label, action, target, result: opts.result ?? 'Done', before: opts.before ?? null, after: opts.after ?? null, eventId: opts.eventId ?? null }], { session: opts.session });
};
