/* Fan-facing events, venues, tables, notify lists and presale checks. */
import { closedReason, colomboParts, eventLabel, fromColombo, PUBLIC_EVENT_STATUS, VIP, type EventCard, type EventDetail, type TableView, type VipTier } from '@void/shared';
import { Event, NotifyEntry, PresaleCode, Table, Tier, Venue, type EventDoc, type TierDoc, type VenueDoc } from '../../db/models/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { getSettings } from '../../lib/platform.js';
import { resolveEvent } from '../../middleware/scope.js';
import { liveTableCodes } from '../layouts/service.js';
import { leftOf } from '../tiers/inventory.js';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const eventCard = (e: EventDoc, hasModel: boolean): EventCard => ({
  id: String(e._id), slug: e.slug, legacyId: e.legacyId ?? null, name: e.name,
  startsAt: e.startsAt.toISOString(), gatesAt: e.gatesAt.toISOString(), endsAt: e.endsAt.toISOString(),
  date: `${colomboParts(e.startsAt).y}-${String(colomboParts(e.startsAt).m).padStart(2, '0')}-${String(colomboParts(e.startsAt).d).padStart(2, '0')}`,
  venue: e.venueName, city: e.city, region: e.region, genre: e.genre, art: e.art,
  fromPriceCents: e.fromPriceCents, status: e.status, label: eventLabel(e as never), organizer: e.organizerName ?? null,
  capacity: e.capacity, hasModel, hasVip: !!e.hasVip,
});

const modelVenues = async () => new Set((await Venue.find({ modelStatus: 'ready' }, { _id: 1 }).lean()).map((v) => String(v._id)));

export const listEvents = async (q: { q?: string; month?: string; city?: string; genre?: string; maxPrice?: number; sort: 'date' | 'price'; page: number; limit: number }) => {
  const f: Record<string, unknown> = { status: { $in: PUBLIC_EVENT_STATUS } };
  if (q.q) { const r = new RegExp(esc(q.q), 'i'); f.$or = [{ name: r }, { venueName: r }, { city: r }, { genre: r }]; }
  if (q.month) { const [y, m] = q.month.split('-').map(Number); f.startsAt = { $gte: fromColombo(y, m, 1), $lt: m === 12 ? fromColombo(y + 1, 1, 1) : fromColombo(y, m + 1, 1) }; }
  if (q.city) f.city = new RegExp(`^${esc(q.city)}$`, 'i');
  if (q.genre) f.genre = q.genre;
  if (q.maxPrice) f.fromPriceCents = { $lte: q.maxPrice * 100 };
  const sort: Record<string, 1> = q.sort === 'price' ? { fromPriceCents: 1, startsAt: 1 } : { startsAt: 1 };
  const [items, total, models] = await Promise.all([
    Event.find(f).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean<EventDoc[]>(),
    Event.countDocuments(f), modelVenues(),
  ]);
  const cities = (await Event.distinct('city', { status: { $in: PUBLIC_EVENT_STATUS } })) as string[];
  return { items: items.map((e) => eventCard(e, models.has(String(e.venueId)))), total, page: q.page, limit: q.limit, cities: cities.sort() };
};

export const tierView = (t: TierDoc) => ({ id: String(t._id), name: t.name, priceCents: t.priceCents, total: t.total, left: leftOf(t), order: t.order, state: t.state, startsAt: t.window?.startsAt?.toISOString() ?? null, endsAt: t.window?.endsAt?.toISOString() ?? null });

export const vipSummary = async (e: EventDoc) => {
  if (!e.hasVip) return null;
  const codes = await liveTableCodes(e._id);
  const tables = await Table.find({ eventId: e._id, code: { $in: codes } }).lean();
  const out = {} as NonNullable<EventDetail['vip']>;
  for (const tier of ['gold', 'platinum'] as VipTier[]) {
    const mine = tables.filter((t) => t.tier === tier);
    out[tier] = { name: VIP[tier].name, minSpendCents: VIP[tier].minSpendCents, seats: VIP[tier].seats, free: mine.filter((t) => t.status === 'available').length, total: mine.length, perks: VIP[tier].perks };
  }
  return out;
};

export const eventDetail = async (ref: string): Promise<EventDetail> => {
  const e = await resolveEvent(ref);
  if (!e || !PUBLIC_EVENT_STATUS.includes(e.status)) throw notFound('Event');
  const ev = e.toObject() as EventDoc;
  const [venue, tiers, settings] = await Promise.all([Venue.findById(ev.venueId).lean<VenueDoc>(), Tier.find({ eventId: ev._id }).sort({ order: 1 }).lean<TierDoc[]>(), getSettings()]);
  const tv = tiers.map(tierView);
  return {
    ...eventCard(ev, venue?.modelStatus === 'ready'),
    about: ev.about, ageLimit: ev.ageLimit,
    playlist: { title: ev.playlist?.title ?? '', url: ev.playlist?.url ?? null, tracks: (ev.playlist?.tracks ?? []).map((t) => ({ title: t.title ?? '', length: t.length ?? '' })) },
    tiers: tv, liveTierId: tv.find((t) => t.state === 'on sale')?.id ?? null,
    vip: await vipSummary(ev), closed: closedReason(ev.status), bookingFeePercent: settings.bookingFeePercent,
  };
};

export const eventTables = async (ref: string): Promise<{ tables: TableView[]; layoutVersion: number | null }> => {
  const e = await resolveEvent(ref);
  if (!e || !PUBLIC_EVENT_STATUS.includes(e.status)) throw notFound('Event');
  const codes = await liveTableCodes(e._id);
  const tables = await Table.find({ eventId: e._id, code: { $in: codes } }).sort({ code: 1 }).lean();
  const { liveLayout } = await import('../layouts/service.js');
  const l = await liveLayout(e._id);
  return { tables: tables.map((t) => ({ code: t.code, tier: t.tier, seats: t.seats, minSpendCents: t.minSpendCents, status: t.status })), layoutVersion: l?.version ?? null };
};

export const checkPresale = async (ref: string, code: string) => {
  const e = await resolveEvent(ref);
  if (!e) throw notFound('Event');
  const c = await PresaleCode.findOne({ eventId: e._id, code: code.toUpperCase(), active: true }).lean();
  if (!c) throw badRequest('That code isn’t valid for this event', { field: 'code' });
  if (c.used + c.held >= c.limit) throw conflict('This presale code has been used up', undefined, 'PRESALE_USED_UP');
  return { valid: true, code: c.code, priceCents: c.priceCents, label: 'Presale', left: c.limit - c.used - c.held };
};

/** Stored only when the event is sold out, registering interest or paused. */
export const joinNotifyList = async (ref: string, b: { email: string; kind?: 'notify' | 'waitlist' | 'resume' }) => {
  const e = await resolveEvent(ref);
  if (!e || !PUBLIC_EVENT_STATUS.includes(e.status)) throw notFound('Event');
  const kind = e.status === 'sold out' ? 'waitlist' : e.status === 'suspended' ? 'resume' : e.status === 'registering' ? 'notify' : null;
  if (!kind) throw conflict('Tickets are on sale now', undefined, 'ON_SALE');
  if (kind === 'waitlist' && !e.waitlistOn) throw conflict('The waitlist for this event is closed');
  await NotifyEntry.updateOne({ eventId: e._id, email: b.email }, { $set: { kind: b.kind ?? kind, consentAt: new Date() }, $unset: { notifiedAt: 1 } }, { upsert: true });
  return { ok: true, kind: b.kind ?? kind, message: 'You’re on the list.' };
};

/* ---------- Venues ---------- */
export const listVenues = async () => {
  const vs = await Venue.find().sort({ capacity: -1 }).lean<VenueDoc[]>();
  const evs = await Event.find({ venueId: { $in: vs.map((v) => v._id) }, status: { $in: PUBLIC_EVENT_STATUS } }, { name: 1, venueId: 1, startsAt: 1, slug: 1, legacyId: 1 }).sort({ startsAt: 1 }).lean();
  return vs.map((v) => {
    const e = evs.find((x) => String(x.venueId) === String(v._id));
    return { id: String(v._id), slug: v.slug, name: v.name, city: v.city, capacity: v.capacity, region: v.region, modelStatus: v.modelStatus, modelUrl: v.modelUrl, event: e ? { id: String(e._id), slug: e.slug, legacyId: e.legacyId, name: e.name } : null };
  });
};

export const venueDetail = async (ref: string) => {
  const v = await Venue.findOne(/^[a-f\d]{24}$/i.test(ref) ? { _id: ref } : { slug: ref.toLowerCase() }).lean<VenueDoc>();
  if (!v) throw notFound('Venue');
  return { id: String(v._id), slug: v.slug, name: v.name, city: v.city, capacity: v.capacity, region: v.region, modelStatus: v.modelStatus, modelUrl: v.modelUrl, widthM: v.widthM, depthM: v.depthM, pois: v.pois };
};
