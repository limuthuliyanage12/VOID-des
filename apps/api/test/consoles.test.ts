import { describe, expect, it } from 'vitest';
import { AuditLog, Layout } from '../src/db/models/index.js';
import { api, bearer, phase3, tokenFor } from './helpers.js';

const base = '/api/v1/admin/events/void-2027';

describe('organizer console', () => {
  it('dashboard shows the prototype numbers', async () => {
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const s = await api().get(`${base}/summary`).set(bearer(org));
    expect(s.status).toBe(200);
    expect(s.body.kpis).toMatchObject({ sold: 1842, capacity: 2400, grossCents: 1_657_800_000, orders: 962, refundRatePercent: 1.2 });
    expect(s.body.finding).toBe('Phase 3 has 158 left');
    expect(s.body.weekly.reduce((n: number, w: { tickets: number }) => n + w.tickets, 0)).toBe(1842);
    expect(s.body.channels).toEqual([{ name: 'Instagram', tickets: 792 }, { name: 'WhatsApp', tickets: 534 }, { name: 'Promoter links', tickets: 313 }, { name: 'Direct', tickets: 203 }]);
    expect(s.body.recentOrders[0].code).toMatch(/^VOID-27/);
    const a = await api().get(`${base}/analytics`).set(bearer(org));
    expect(a.body.payments).toEqual([{ method: 'Card', amountCents: 1_281_000_000 }, { method: 'Koko', amountCents: 284_000_000 }, { method: 'Split pay', amountCents: 94_000_000 }]);
  });

  it('orders filter and export, with party pass tags', async () => {
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const all = await api().get(`${base}/orders`).set(bearer(org));
    expect(all.body.showing).toMatch(/^Showing \d+ of \d+$/);
    const split = await api().get(`${base}/orders?status=Split pending`).set(bearer(org));
    expect(split.body.items.map((o: { code: string }) => o.code).sort()).toEqual(['VOID-2701836', 'VOID-2701837', 'VOID-2701841']);
    expect(all.body.items.find((o: { code: string }) => o.code === 'VOID-2701838').partyPass).toBe(true);
    expect((await api().get(`${base}/orders?q=nethmi`).set(bearer(org))).body.total).toBe(1);
    const csv = await api().get(`${base}/orders.csv`).set(bearer(org));
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toBe('Order,Attendee,Email,Item,Qty,Amount (LKR),Status,Payment,Created (UTC)');
  });

  it('tiers: quantity can not go below sold, sold-out tiers are locked', async () => {
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const t = await phase3();
    expect((await api().patch(`${base}/tiers/${t._id}`).set(bearer(org)).send({ total: 100 })).body.code).toBe('BELOW_SOLD');
    const tiers = await api().get(`${base}/tiers`).set(bearer(org));
    const early = tiers.body.tiers.find((x: { name: string }) => x.name === 'Early Bird');
    expect((await api().patch(`${base}/tiers/${early.id}`).set(bearer(org)).send({ price: 1 })).body.code).toBe('TIER_LOCKED');
    expect(tiers.body.presales[0]).toMatchObject({ code: 'VOIDFRIENDS', used: 32, limit: 100 });
    expect(tiers.body.launch).toMatchObject({ preRegistrations: 1286, compsIssued: 24, compLimit: 50 });
  });

  it('layout publish, then super admin approves and the fan map follows', async () => {
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const sup = await tokenFor('super@eventsbythevoid.lk');
    const pending = await api().get('/api/v1/super/layouts?status=awaiting').set(bearer(sup));
    expect(pending.body.items).toHaveLength(1);
    const ch = await api().post(`/api/v1/super/layouts/${pending.body.items[0].id}/request-changes`).set(bearer(sup)).send({ note: 'Move the bar' });
    expect(ch.body.status).toBe('changes requested');
    const cur = await api().get(`${base}/layout`).set(bearer(org));
    const objects = cur.body.working.objects.filter((o: { name: string }) => !['G07', 'G08', 'P07', 'P08'].includes(o.name));
    const saved = await api().put(`${base}/layout`).set(bearer(org)).send({ objects });
    expect(saved.body.summary).toMatchObject({ tables: 12, gaCapacity: 2400, stalls: 6 });
    const pub = await api().post(`${base}/layout/publish`).set(bearer(org));
    expect(pub.body).toMatchObject({ status: 'awaiting review', version: 4 });
    const ok = await api().post(`/api/v1/super/layouts/${pub.body.id}/approve`).set(bearer(sup));
    expect(ok.body.message).toBe('Layout approved. The fan table map now shows 12 tables.');
    expect((await api().get('/api/v1/events/void-2027/tables')).body.tables).toHaveLength(12);
    expect(await Layout.countDocuments({ live: true })).toBe(1);
  });

  it('tracked links count clicks and tag the browser', async () => {
    const r = await api().get('/api/v1/r/ig-launch');
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/event\.html#e0$/);
    expect(r.headers['set-cookie'][0]).toMatch(/^void_ref=ig-launch/);
    const org = await tokenFor('nimal.perera@organizers.example.com');
    expect((await api().get(`${base}/campaigns`).set(bearer(org))).body.items[0]).toMatchObject({ ref: 'ig-launch', clicks: 8421 });
    const prev = await api().post(`${base}/messages/preview`).set(bearer(org)).send({ channel: 'sms', audience: 'all', body: 'Gates open at 4 pm. See you out of the dark.' });
    expect(prev.body.costCents).toBe(prev.body.recipients * 250);
    expect((await api().post(`${base}/messages/preview`).set(bearer(org)).send({ channel: 'sms', audience: 'all', body: 'x'.repeat(161) })).status).toBe(400);
  });

  it('finance and invoices', async () => {
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const f = await api().get(`${base}/finance`).set(bearer(org));
    expect(f.body.nextPayout.line).toBe('LKR 7,920,000 on 28 Feb 2027 to Commercial Bank •••• 4821');
    expect(f.body.kpis.netCents).toBe(f.body.kpis.grossCents - f.body.kpis.feesCents - f.body.kpis.refundsCents);
    const inv = await api().get(`${base}/invoices`).set(bearer(org));
    expect(inv.body.items.find((i: { number: string }) => i.number === 'INV-027').due).toBe('Due today');
    const made = await api().post(`${base}/invoices`).set(bearer(org)).send({ billTo: 'Lights Co', description: 'Extra rigs', amount: 50_000, dueAt: '2027-02-25' });
    expect(made.body.number).toBe('INV-028');
  });
});

describe('platform console', () => {
  it('overview queue matches the seed', async () => {
    const sup = await tokenFor('super@eventsbythevoid.lk');
    const o = await api().get('/api/v1/super/overview').set(bearer(sup));
    expect(o.body.decisions).toMatchObject({ eventRequests: 2, payoutBatches: 3, eventsWithoutAdmin: 1 });
    expect(o.body.kpis.grossCents).toBeGreaterThanOrEqual(2_723_800_000);
  });

  it('pause sales changes the fan page and blocks checkout; restore brings it back', async () => {
    const sup = await tokenFor('super@eventsbythevoid.lk');
    expect((await api().post('/api/v1/super/events/void-2027/suspend').set(bearer(sup))).body.label).toBe('Suspended');
    expect((await api().get('/api/v1/events/void-2027')).body.label).toBe('Sales paused');
    const t = await phase3();
    expect((await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 1 })).status).toBe(423);
    expect((await api().post('/api/v1/super/events/void-2027/restore').set(bearer(sup))).body.status).toBe('live');
    expect((await api().get('/api/v1/events/void-2027')).body.label).toBe('Selling fast');
    expect(await AuditLog.countDocuments({ action: { $in: ['Paused sales', 'Restored sales'] } })).toBe(2);
  });

  it('approves events but not one with no organizer; one admin per event', async () => {
    const sup = await tokenFor('super@eventsbythevoid.lk');
    expect((await api().post('/api/v1/super/events/galle-fort-afterglow/approve').set(bearer(sup))).body.code).toBe('NO_ORGANIZER');
    await api().post('/api/v1/events/island-frequencies/notify').send({ email: 'early@example.com', consent: true });
    expect((await api().post('/api/v1/super/events/island-frequencies/approve').set(bearer(sup))).body.status).toBe('live');
    const galle = (await api().get('/api/v1/super/events?q=galle').set(bearer(sup))).body.items[0];
    expect((await api().post('/api/v1/super/admins/invite').set(bearer(sup)).send({ name: 'Admin Galle', email: 'galle.admin@example.com', eventId: galle.id })).status).toBe(201);
    expect((await api().post('/api/v1/super/admins/invite').set(bearer(sup)).send({ name: 'Second Admin', email: 'second@example.com', eventId: galle.id })).body.code).toBe('EVENT_HAS_ADMIN');
    expect((await api().post('/api/v1/super/events/galle-fort-afterglow/approve').set(bearer(sup))).body.status).toBe('live');
  });

  it('payouts: approve produces a bank file, then mark paid', async () => {
    const sup = await tokenFor('super@eventsbythevoid.lk');
    const a = await api().post('/api/v1/super/payouts/PB-2702/approve').set(bearer(sup));
    expect(a.body.status).toBe('approved');
    expect(a.body.bankFile).toContain('PB-2702');
    expect((await api().post('/api/v1/super/payouts/PB-2702/approve').set(bearer(sup))).status).toBe(409);
    expect((await api().post('/api/v1/super/payouts/PB-2702/mark-paid').set(bearer(sup)).send({ bankRef: 'COMB-90001' })).body.status).toBe('paid');
    /* Seeded prototype entries are dated Feb 2027, so search rather than assume position. */
    const audit = await api().get('/api/v1/super/audit?q=PB-2702').set(bearer(sup));
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['Approved payout', 'Marked payout paid']));
    const csv = await api().get('/api/v1/super/audit.csv').set(bearer(sup));
    expect(csv.text).toContain('Marked payout paid');
  });
});
