import { describe, expect, it } from 'vitest';
import { Event, Hold, PresaleCode, Tier } from '../src/db/models/index.js';
import { createHold, expireHold, sweepHolds } from '../src/modules/holds/service.js';
import { leftOf } from '../src/modules/tiers/inventory.js';
import { api, phase3 } from './helpers.js';

describe('holds and inventory', () => {
  it('never oversells: 200 concurrent holds at the last 158 Phase 3 tickets', async () => {
    const t = await phase3();
    expect(leftOf(t)).toBe(158);
    const results = await Promise.allSettled(Array.from({ length: 200 }, () => createHold({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 1 }, {})));
    const won = results.filter((r) => r.status === 'fulfilled').length;
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toBe(158);
    expect(lost).toHaveLength(42);
    expect(lost.every((r) => (r as PromiseRejectedResult).reason.code === 'NOT_ENOUGH_LEFT')).toBe(true);
    const after = await Tier.findById(t._id).lean();
    expect(after!.held).toBe(158);
    expect(after!.sold + after!.held).toBeLessThanOrEqual(after!.total);
    expect(await Hold.countDocuments({ tierId: t._id, status: 'active' })).toBe(158);
  }, 120_000);

  it('answers 409 with the remaining count when there are not enough left', async () => {
    const t = await phase3();
    const r = await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 2 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NOT_ENOUGH_LEFT', details: { left: 0 } });
  });

  it('gives seats back when holds expire, through the job and the sweep', async () => {
    const t = await phase3();
    const some = await Hold.find({ tierId: t._id, status: 'active' }).limit(3).lean();
    await Hold.updateMany({ _id: { $in: some.map((h) => h._id) } }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expireHold({ holdId: String(some[0]._id) });
    expect(leftOf((await Tier.findById(t._id).lean())!)).toBe(1);
    expect(await sweepHolds()).toBe(2);
    expect(leftOf((await Tier.findById(t._id).lean())!)).toBe(3);
    /* Release everything for the next tests. */
    await Hold.updateMany({ tierId: t._id, status: 'active' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await sweepHolds();
    expect(leftOf((await Tier.findById(t._id).lean())!)).toBe(158);
  });

  it('a hold that is not yet due is left alone', async () => {
    const t = await phase3();
    const h = await createHold({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 1 }, {});
    await expireHold({ holdId: h.id });
    expect((await Hold.findById(h.id).lean())!.status).toBe('active');
    const del = await api().delete(`/api/v1/holds/${h.id}`).set('X-Hold-Secret', h.secret!);
    expect(del.status).toBe(204);
    expect(leftOf((await Tier.findById(t._id).lean())!)).toBe(158);
    expect((await api().delete(`/api/v1/holds/${h.id}`).set('X-Hold-Secret', 'wrong-secret-123456')).status).toBe(404);
  });

  it('limits GA to 1 to 10 per order', async () => {
    const t = await phase3();
    expect((await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 11 })).status).toBe(400);
    expect((await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 0 })).status).toBe(400);
  });

  it('only sells the tier that is on sale', async () => {
    const e = await Event.findOne({ slug: 'void-2027' }).lean();
    const early = await Tier.findOne({ eventId: e!._id, name: 'Early Bird' }).lean();
    const gate = await Tier.findOne({ eventId: e!._id, name: 'Gate' }).lean();
    expect((await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(early!._id), qty: 1 })).body.code).toBe('TIER_CLOSED');
    expect((await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(gate!._id), qty: 1 })).body.code).toBe('TIER_CLOSED');
  });

  it('presale codes unlock the hidden price and stop at their limit', async () => {
    const t = await phase3();
    const check = await api().post('/api/v1/events/void-2027/presale').send({ code: 'voidfriends' });
    expect(check.body).toMatchObject({ valid: true, priceCents: 750_000, left: 68 });
    expect((await api().post('/api/v1/events/void-2027/presale').send({ code: 'NOPE' })).status).toBe(400);
    const h = await createHold({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 2, presaleCode: 'VOIDFRIENDS' }, {});
    expect(h).toMatchObject({ unitCents: 750_000, label: '2 × Presale' });
    await PresaleCode.updateOne({ code: 'VOIDFRIENDS' }, { $set: { used: 98 } });
    await expect(createHold({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 1, presaleCode: 'VOIDFRIENDS' }, {})).rejects.toMatchObject({ code: 'PRESALE_USED_UP' });
    await api().delete(`/api/v1/holds/${h.id}`).set('X-Hold-Secret', h.secret!);
    await PresaleCode.updateOne({ code: 'VOIDFRIENDS' }, { $set: { used: 32 } });
    expect((await PresaleCode.findOne({ code: 'VOIDFRIENDS' }).lean())!.held).toBe(0);
  });

  it('holds a table only for the tier the buyer chose, and only if free', async () => {
    const wrong = await api().post('/api/v1/holds').send({ kind: 'table', eventId: 'void-2027', tableCode: 'G01', vipTier: 'platinum' });
    expect(wrong.status).toBe(403);
    const taken = await api().post('/api/v1/holds').send({ kind: 'table', eventId: 'void-2027', tableCode: 'G03', vipTier: 'gold' });
    expect(taken.body.code).toBe('TABLE_TAKEN');
    const ok = await api().post('/api/v1/holds').send({ kind: 'table', eventId: 'void-2027', tableCode: 'G01', vipTier: 'gold' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ unitCents: 10_000_000, label: 'Table G01 · Gold' });
    const again = await api().post('/api/v1/holds').send({ kind: 'table', eventId: 'void-2027', tableCode: 'G01', vipTier: 'gold' });
    expect(again.body.code).toBe('TABLE_TAKEN');
    await api().delete(`/api/v1/holds/${ok.body.id}`).set('X-Hold-Secret', ok.body.secret);
    const t = await api().get('/api/v1/events/void-2027/tables');
    expect(t.body.tables.find((x: { code: string }) => x.code === 'G01').status).toBe('available');
  });

  it('returns 423 when sales are paused, and the event page says so', async () => {
    const t = await phase3();
    await Event.updateOne({ slug: 'void-2027' }, { $set: { status: 'suspended', statusBeforeSuspend: 'live' } });
    const r = await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 1 });
    expect(r.status).toBe(423);
    expect(r.body.message).toBe('Sales are paused');
    expect((await api().get('/api/v1/events/void-2027')).body.closed).toEqual({ kind: 'paused', action: 'Tell Me When Sales Resume' });
    expect((await api().post('/api/v1/events/void-2027/notify').send({ email: 'waiting@example.com', consent: true })).body.kind).toBe('resume');
    await Event.updateOne({ slug: 'void-2027' }, { $set: { status: 'live', statusBeforeSuspend: null } });
  });

  it('opens the next tier when one sells out, in the same transaction', async () => {
    const t = await phase3();
    await Tier.updateOne({ _id: t._id }, { $set: { sold: 398 } });
    const { tx } = await import('../src/db/connect.js');
    const { convertTier, reserveTier } = await import('../src/modules/tiers/inventory.js');
    await tx(async (s) => { await reserveTier(t._id, 2, s); await convertTier(t._id, 2, s); });
    const ts = await Tier.find({ eventId: t.eventId }).sort({ order: 1 }).lean();
    expect(ts[3].state).toBe('sold out');
    expect(ts[4].state).toBe('on sale');
    await Tier.updateOne({ _id: t._id }, { $set: { sold: 242, state: 'on sale' } });
    await Tier.updateOne({ _id: ts[4]._id }, { $set: { state: 'up next' } });
  });
});
