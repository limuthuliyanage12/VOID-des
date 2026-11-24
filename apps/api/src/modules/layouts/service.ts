/*
 * Venue layouts. The builder saves drafts freely. Publish sends the draft for review and bumps the version.
 * Approve makes it the one live layout; the fan table map reads tables only from it. Request changes sends it back with a note.
 */
import type { ClientSession, Types } from 'mongoose';
import { TABLE_CODE_RE, VIP, type VipTier } from '@void/shared';
import { tx } from '../../db/connect.js';
import { Event, Layout, Table, type LayoutDoc } from '../../db/models/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit, type Actor } from '../../lib/platform.js';
import { putFile } from '../../lib/storage.js';

type Id = Types.ObjectId | string;
type Obj = { type: string; name: string; x: number; y: number; w: number; h: number; capacity?: number; tier?: string };

export const liveLayout = (eventId: Id, session?: ClientSession) => Layout.findOne({ eventId, live: true }, null, { session }).lean<LayoutDoc>();

export const tableCodesOf = (objects: Obj[]) => objects.filter((o) => o.type === 'table' && TABLE_CODE_RE.test(o.name)).map((o) => o.name);

export const liveTableCodes = async (eventId: Id, session?: ClientSession) => {
  const l = await liveLayout(eventId, session);
  return l ? tableCodesOf(l.objects as Obj[]) : [];
};

export const summarise = (objects: Obj[]) => {
  const tables = objects.filter((o) => o.type === 'table');
  return {
    gaCapacity: objects.filter((o) => o.type === 'zone').reduce((n, o) => n + (o.capacity ?? 0), 0),
    tables: tables.length, seats: tables.reduce((n, o) => n + (o.capacity ?? 0), 0),
    stalls: objects.filter((o) => o.type === 'stall').length, objects: objects.length,
  };
};

const view = (l: LayoutDoc | null) => l && ({
  id: String(l._id), version: l.version, status: l.status, live: l.live, objects: l.objects, widthM: l.widthM, depthM: l.depthM,
  floorPlanUrl: l.floorPlanUrl, reviewNote: l.reviewNote, submittedAt: l.submittedAt ?? null, reviewedAt: l.reviewedAt ?? null, summary: summarise(l.objects as Obj[]),
});

/** The layout the organizer is working on: an open draft or submission, else the live one. */
const working = async (eventId: Id) =>
  (await Layout.findOne({ eventId, live: false, status: { $in: ['draft', 'awaiting review', 'changes requested'] } }).sort({ updatedAt: -1 }).lean<LayoutDoc>()) ?? (await liveLayout(eventId));

export const getLayout = async (eventId: string) => {
  const w = await working(eventId), l = await liveLayout(eventId);
  return { working: view(w), live: view(l) };
};

export const saveDraft = async (eventId: string, b: { objects: Obj[]; widthM?: number; depthM?: number }, actor: Actor) => {
  const w = await working(eventId);
  const set = { objects: b.objects, ...(b.widthM ? { widthM: b.widthM } : {}), ...(b.depthM ? { depthM: b.depthM } : {}), status: 'draft' };
  let doc;
  if (w && !w.live) doc = await Layout.findOneAndUpdate({ _id: w._id, eventId }, { $set: set }, { new: true }).lean<LayoutDoc>();
  else doc = (await Layout.create({ eventId, version: w?.version ?? 1, ...set, widthM: b.widthM ?? w?.widthM ?? 80, depthM: b.depthM ?? w?.depthM ?? 60, floorPlanUrl: w?.floorPlanUrl ?? null })).toObject() as LayoutDoc;
  await audit(actor, 'Saved layout draft', `v${doc!.version}`, { eventId });
  return view(doc!);
};

export const publish = async (eventId: string, actor: Actor) => {
  const w = await working(eventId);
  if (!w || w.live) throw conflict('Save a draft before publishing');
  if (w.status === 'awaiting review') throw conflict('This layout is already waiting for review');
  const doc = await Layout.findOneAndUpdate({ _id: w._id, eventId, status: { $in: ['draft', 'changes requested'] } }, { $set: { status: 'awaiting review', submittedBy: actor.id, submittedAt: new Date(), reviewNote: null }, $inc: { version: 1 } }, { new: true }).lean<LayoutDoc>();
  if (!doc) throw conflict('The layout changed while publishing. Try again.');
  const ev = await Event.findById(eventId, { name: 1 }).lean<{ name: string }>();
  await audit(actor, 'Published layout', `${ev?.name} · v${doc.version}`, { eventId, result: 'Awaiting review' });
  return view(doc);
};

export const uploadFloorPlan = async (eventId: string, buf: Buffer, actor: Actor) => {
  const f = await putFile('floor-plan', eventId, buf);
  const w = await working(eventId);
  if (w && !w.live) await Layout.updateOne({ _id: w._id }, { $set: { floorPlanUrl: f.url } });
  else await Layout.create({ eventId, version: w?.version ?? 1, status: 'draft', objects: w?.objects ?? [], floorPlanUrl: f.url });
  await audit(actor, 'Uploaded floor plan', f.key, { eventId });
  return { url: f.url };
};

/* ---------- Super admin review ---------- */
export const listForReview = async (status?: string) => {
  const q = status === 'awaiting' || status === 'awaiting review' ? { status: 'awaiting review' } : status ? { status } : {};
  const ls = await Layout.find(q).sort({ updatedAt: -1 }).limit(200).lean<LayoutDoc[]>();
  const names = new Map((await Event.find({ _id: { $in: ls.map((l) => l.eventId) } }, { name: 1 }).lean()).map((e) => [String(e._id), e.name]));
  return ls.map((l) => ({ ...view(l)!, event: names.get(String(l.eventId)) ?? '', eventId: String(l.eventId), tables: tableCodesOf(l.objects as Obj[]).length }));
};

export const approve = async (id: string, actor: Actor) => {
  const r = await tx(async (s) => {
    const l = await Layout.findOne({ _id: id, status: 'awaiting review' }, null, { session: s }).lean<LayoutDoc>();
    if (!l) return null;
    await Layout.updateMany({ eventId: l.eventId, live: true }, { $set: { live: false } }, { session: s });
    await Layout.updateOne({ _id: l._id }, { $set: { status: 'approved', live: true, reviewedBy: actor.id, reviewedAt: new Date() } }, { session: s });
    /* Make sure every table on the plan exists, so the fan map can hold it. */
    const codes = tableCodesOf(l.objects as Obj[]);
    for (const code of codes) {
      const tier: VipTier = code.startsWith('G') ? 'gold' : 'platinum';
      await Table.updateOne({ eventId: l.eventId, code }, { $setOnInsert: { eventId: l.eventId, code, tier, seats: VIP[tier].seats, minSpendCents: VIP[tier].minSpendCents, status: 'available' } }, { upsert: true, session: s });
    }
    if (codes.length) await Event.updateOne({ _id: l.eventId }, { $set: { hasVip: true } }, { session: s });
    return { l, codes };
  });
  if (!r) throw notFound('A layout waiting for review');
  const ev = await Event.findById(r.l.eventId, { name: 1 }).lean<{ name: string }>();
  await audit(actor, 'Approved layout', `${ev?.name} · v${r.l.version}`, { eventId: r.l.eventId, result: 'Approved', after: { tables: r.codes.length } });
  return { id, version: r.l.version, tables: r.codes.length, message: `Layout approved. The fan table map now shows ${r.codes.length} tables.` };
};

export const requestChanges = async (id: string, note: string | undefined, actor: Actor) => {
  const l = await Layout.findOneAndUpdate({ _id: id, status: 'awaiting review' }, { $set: { status: 'changes requested', reviewNote: note ?? 'Please review and resubmit', reviewedBy: actor.id, reviewedAt: new Date() } }, { new: true }).lean<LayoutDoc>();
  if (!l) throw notFound('A layout waiting for review');
  const ev = await Event.findById(l.eventId, { name: 1 }).lean<{ name: string }>();
  await audit(actor, 'Requested layout changes', `${ev?.name} · v${l.version}`, { eventId: l.eventId, result: 'Changes requested', after: { note: l.reviewNote } });
  return view(l);
};
