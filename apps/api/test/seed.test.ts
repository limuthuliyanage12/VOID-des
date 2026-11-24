import { describe, expect, it } from 'vitest';
import { seedCheck } from '../src/seed/check.js';
import { api } from './helpers.js';

describe('seed', () => {
  it('reproduces the prototype numbers', async () => {
    const checks = await seedCheck();
    const failed = checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(checks.length).toBeGreaterThan(15);
  });

  it('serves the event list the home page needs', async () => {
    const r = await api().get('/api/v1/events?limit=8');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(8);
    expect(r.body.items[0]).toMatchObject({ name: 'VOID 2027', label: 'Selling fast', fromPriceCents: 900_000, venue: 'Lotus Tower', hasModel: true, hasVip: true });
    expect(r.body.cities).toEqual(['Colombo', 'Galle', 'Kandy', 'Mirissa']);
  });

  it('filters like the discovery bar', async () => {
    expect((await api().get('/api/v1/events?genre=Jazz')).body.items.map((e: { name: string }) => e.name)).toEqual(['Colombo Jazz Collective']);
    expect((await api().get('/api/v1/events?city=mirissa')).body.total).toBe(1);
    expect((await api().get('/api/v1/events?month=2027-03')).body.total).toBe(4);
    expect((await api().get('/api/v1/events?maxPrice=3000')).body.items.map((e: { name: string }) => e.name)).toEqual(['The Sunday Sessions']);
    expect((await api().get('/api/v1/events?q=lotus')).body.total).toBe(1);
    expect((await api().get('/api/v1/events?sort=price')).body.items[0].name).toBe('The Sunday Sessions');
  });

  it('shows the flagship event page with tiers and VIP', async () => {
    const r = await api().get('/api/v1/events/void-2027');
    expect(r.status).toBe(200);
    const p3 = r.body.tiers.find((t: { name: string }) => t.name === 'Phase 3');
    expect(p3).toMatchObject({ left: 158, state: 'on sale', priceCents: 900_000 });
    expect(r.body.vip.gold).toMatchObject({ free: 6, total: 8, minSpendCents: 10_000_000, seats: 6 });
    expect(r.body.vip.platinum).toMatchObject({ free: 5, total: 8, minSpendCents: 18_000_000, seats: 10 });
    expect(r.body.closed).toBeNull();
    expect(r.body.bookingFeePercent).toBe(5);
    expect((await api().get('/api/v1/events/0')).body.slug).toBe('void-2027');
  });

  it('gives closed reasons for events that are not bookable', async () => {
    expect((await api().get('/api/v1/events/hill-country-unplugged')).body.closed).toEqual({ kind: 'sold out', action: 'Join Waitlist' });
    expect((await api().get('/api/v1/events/island-frequencies')).body.closed).toEqual({ kind: 'registering', action: 'Notify Me' });
  });

  it('serves the table map from the approved layout and the venue points', async () => {
    const t = await api().get('/api/v1/events/void-2027/tables');
    expect(t.body.tables).toHaveLength(16);
    expect(t.body.layoutVersion).toBe(2);
    const v = await api().get('/api/v1/venues/lotus-tower');
    expect(v.body.pois).toHaveLength(31);
  });
});
