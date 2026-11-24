import { describe, expect, it } from 'vitest';
import { Event, GateStaff, Ticket, User } from '../src/db/models/index.js';
import { signPayload, newKeyPair } from '../src/lib/qr.js';
import { totpAt, verifyTotp, newTotpSecret } from '../src/lib/totp.js';
import { api, bearer, payhereNotify, startOrder, tokenFor } from './helpers.js';

const base = '/api/v1/admin/events/void-2027';

const paidTicket = async () => {
  const { checkout } = await startOrder({ qty: 1 });
  await payhereNotify(checkout.order.code, checkout.order.totalCents);
  const v = await api().get(`/api/v1/orders/${checkout.order.code}?t=${checkout.viewToken}`);
  return { qr: v.body.tickets[0].qr as string, id: v.body.tickets[0].id as string, code: checkout.order.code };
};

describe('gate scanning', () => {
  it('admits a valid ticket once, then blocks the duplicate', async () => {
    const gate = await tokenFor('chamara.fonseka@staff.example.com');
    const { qr } = await paidTicket();
    const a = await api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: qr, deviceId: 'phone-1', gate: 'Gate 02' });
    expect(a.body).toMatchObject({ result: 'admitted', holderName: 'Test Buyer', admits: 1 });
    const b = await api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: qr, deviceId: 'phone-2' });
    expect(b.body.result).toBe('duplicate');
    expect(b.body.message).toMatch(/Already admitted/);
    const stats = await api().get(`${base}/gate/stats`).set(bearer(gate));
    expect(stats.body).toMatchObject({ checkedIn: 1, duplicatesBlocked: 1, capacity: 2400 });
  });

  it('20 devices racing on one QR admit it exactly once', async () => {
    const gate = await tokenFor('chamara.fonseka@staff.example.com');
    const { qr } = await paidTicket();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: qr, deviceId: `d${i}` })));
    expect(rs.filter((r) => r.body.result === 'admitted')).toHaveLength(1);
    expect(rs.filter((r) => r.body.result === 'duplicate')).toHaveLength(19);
  });

  it('blocks refunded, forged, transferred and wrong-event QRs', async () => {
    const gate = await tokenFor('chamara.fonseka@staff.example.com');
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const r = await paidTicket();
    await api().post(`${base}/orders/${r.code}/refund`).set(bearer(org)).send({});
    expect((await api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: r.qr, deviceId: 'p' })).body).toMatchObject({ result: 'invalid', message: 'This ticket was refunded or cancelled' });

    const fake = signPayload({ t: r.id, e: String((await Event.findOne({ slug: 'void-2027' }).lean())!._id), a: 6, k: 1, q: 1 }, newKeyPair().privateKeyPem);
    expect((await api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: fake, deviceId: 'p' })).body.result).toBe('invalid');

    const other = await Event.findOne({ slug: 'after-hours-warehouse' }).lean();
    const wrong = signPayload({ t: r.id, e: String(other!._id), a: 1, k: 1, q: 1 }, newKeyPair().privateKeyPem);
    expect((await api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: wrong, deviceId: 'p' })).body.result).toBe('wrong event');
    expect((await api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: 'hello-not-a-ticket', deviceId: 'p' })).body.result).toBe('invalid');
  });

  it('a transfer re-issues the ticket and kills the old QR', async () => {
    const gate = await tokenFor('chamara.fonseka@staff.example.com');
    const sanduni = await tokenFor('sanduni.w@example.com');
    const mine = await api().get('/api/v1/me/tickets').set(bearer(sanduni));
    const t = mine.body.upcoming.find((x: { status: string }) => x.status === 'valid');
    const tr = await api().post(`/api/v1/tickets/${t.id}/transfer`).set(bearer(sanduni)).send({ toName: 'Amali Perera', toEmail: 'amali@example.com' });
    expect(tr.status).toBe(201);
    const token = new URL(tr.body.demoLink).searchParams.get('transfer')!;
    const acc = await api().post(`/api/v1/transfers/${token}/accept`).send({});
    expect(acc.body.holderName).toBe('Amali Perera');
    expect((await api().post(`${base}/gate/scan`).set(bearer(gate)).send({ token: t.qr, deviceId: 'p' })).body.message).toBe('This QR was replaced by a transfer');
    expect((await api().post(`/api/v1/transfers/${token}/accept`).send({})).status).toBe(410);
    expect((await Ticket.findById(acc.body.ticketId).lean())!.qrSecretVersion).toBe(2);
  });

  it('offline sync keeps the earliest admit and flags the other device', async () => {
    const gate = await tokenFor('chamara.fonseka@staff.example.com');
    const { qr } = await paidTicket();
    const t0 = Date.now() - 60_000;
    const late = await api().post(`${base}/gate/scan/batch`).set(bearer(gate)).send({ scans: [{ token: qr, deviceId: 'B', scannedAt: new Date(t0 + 30_000).toISOString() }] });
    expect(late.body.results[0].result).toBe('admitted');
    const early = await api().post(`${base}/gate/scan/batch`).set(bearer(gate)).send({ scans: [{ token: qr, deviceId: 'A', scannedAt: new Date(t0).toISOString() }] });
    expect(early.body.results[0].result).toBe('admitted');
    const stats = await api().get(`${base}/gate/stats`).set(bearer(gate));
    expect(stats.body.flagged).toBeGreaterThanOrEqual(1);
  });

  it('respects the gate access toggle and serves the offline verification keys', async () => {
    const piumi = await User.findOne({ email: 'piumi.herath@staff.example.com' }).lean();
    const tok = await tokenFor('piumi.herath@staff.example.com');
    expect(Object.keys((await api().get(`${base}/gate/keys`).set(bearer(tok))).body.keys)).toContain('1');
    await GateStaff.updateOne({ userId: piumi!._id }, { $set: { gateAccess: false } });
    const r = await api().post(`${base}/gate/scan`).set(bearer(tok)).send({ token: 'V1.x.y', deviceId: 'p' });
    expect(r.status).toBe(403);
    /* Gate staff can't open organizer screens. */
    expect((await api().get(`${base}/orders`).set(bearer(tok))).status).toBe(403);
    const anjali = await tokenFor('anjali.cooray@staff.example.com');
    const t = await (await import('./helpers.js')).phase3();
    const sale = await api().post(`${base}/gate/box-office/sale`).set(bearer(anjali)).send({ tierId: String(t._id), qty: 1, name: 'Walk Up' });
    expect(sale.status).toBe(201);
    expect(sale.body.tickets).toHaveLength(1);
  });
});

describe('scope guard', () => {
  it('an organizer can never see another event', async () => {
    const nimal = await tokenFor('nimal.perera@organizers.example.com');
    const other = await Event.findOne({ slug: 'after-hours-warehouse' }).lean();
    for (const path of ['summary', 'orders', 'finance', 'tiers', 'splits', 'layout', 'invoices', 'gate/stats', 'orders.csv']) {
      expect((await api().get(`/api/v1/admin/events/${other!._id}/${path}`).set(bearer(nimal))).status, path).toBe(403);
      expect((await api().get(`/api/v1/admin/events/after-hours-warehouse/${path}`).set(bearer(nimal))).status, path).toBe(403);
    }
    expect((await api().get('/api/v1/admin/events/000000000000000000000000/summary').set(bearer(nimal))).status).toBe(403);
    expect((await api().post(`/api/v1/admin/events/${other!._id}/tiers`).set(bearer(nimal)).send({ name: 'Sneaky', price: 1, total: 1 })).status).toBe(403);
    expect((await api().get('/api/v1/admin/events/void-2027/summary').set(bearer(nimal))).status).toBe(200);
    expect((await api().get('/api/v1/super/overview').set(bearer(nimal))).status).toBe(403);
  });

  it('the super admin can see any event; a fan sees none', async () => {
    const sup = await tokenFor('super@eventsbythevoid.lk');
    expect((await api().get('/api/v1/admin/events/after-hours-warehouse/summary').set(bearer(sup))).status).toBe(200);
    const fan = await tokenFor('sanduni.w@example.com');
    expect((await api().get('/api/v1/admin/events/void-2027/summary').set(bearer(fan))).status).toBe(403);
    expect((await api().get('/api/v1/admin/events/void-2027/summary')).status).toBe(401);
  });

  it('a token whose access changed is refused on writes', async () => {
    const tok = await tokenFor('dilini.fernando@organizers.example.com');
    const flag = await Event.findOne({ slug: 'void-2027' }).lean();
    await User.updateOne({ email: 'dilini.fernando@organizers.example.com' }, { $set: { assignedEventId: flag!._id } });
    const r = await api().post('/api/v1/admin/events/after-hours-warehouse/tiers').set(bearer(tok)).send({ name: 'Late', price: 100, total: 10 });
    expect(r.body.code).toBe('SESSION_STALE');
    const other = await Event.findOne({ slug: 'after-hours-warehouse' }).lean();
    await User.updateOne({ email: 'dilini.fernando@organizers.example.com' }, { $set: { assignedEventId: other!._id } });
  });
});

describe('auth', () => {
  it('signs up, refreshes with rotation, detects reuse, and logs in', async () => {
    const agent = (await import('supertest')).default.agent((await import('./helpers.js')).app);
    expect((await agent.post('/api/v1/auth/signup').send({ name: 'New Fan', email: 'new.fan@example.com', password: 'password' })).status).toBe(400);
    const s = await agent.post('/api/v1/auth/signup').send({ name: 'New Fan', email: 'new.fan@example.com', password: 'out-of-the-dark-27' });
    expect(s.status).toBe(201);
    expect(s.body.user.role).toBe('fan');
    const cookie = s.headers['set-cookie'][0].split(';')[0];
    const r1 = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(r1.status).toBe(200);
    const reuse = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(reuse.body.code).toBe('SESSION_REUSED');
    const next = r1.headers['set-cookie'][0].split(';')[0];
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', next)).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: 'new.fan@example.com', password: 'wrong' })).body.code).toBe('BAD_CREDENTIALS');
    expect((await api().post('/api/v1/auth/login').send({ email: 'NEW.FAN@example.com', password: 'out-of-the-dark-27' })).status).toBe(200);
  });

  it('TOTP matches the RFC 6238 test vector and staff login needs it once enabled', async () => {
    /* RFC 6238 SHA-1 secret "12345678901234567890", T = 59 s → 94287082 (last 6 digits 287082). */
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
    const secret = newTotpSecret();
    expect(verifyTotp(secret, totpAt(secret))).toBe(true);
    const login = await api().post('/api/v1/auth/login').send({ email: 'nimal.perera@organizers.example.com', password: 'Void-demo-2027' });
    expect(login.body.mfaSetupRequired).toBe(true);
    const tok = login.body.accessToken;
    const setup = await api().post('/api/v1/auth/totp/setup').set(bearer(tok));
    const ok = await api().post('/api/v1/auth/totp/verify').set(bearer(tok)).send({ otp: totpAt(setup.body.secret) });
    expect(ok.body.user.mfa).toBe(true);
    expect((await api().post('/api/v1/auth/login').send({ email: 'nimal.perera@organizers.example.com', password: 'Void-demo-2027' })).body.code).toBe('MFA_CODE_REQUIRED');
    expect((await api().post('/api/v1/auth/login').send({ email: 'nimal.perera@organizers.example.com', password: 'Void-demo-2027', otp: totpAt(setup.body.secret) })).body.user.mfa).toBe(true);
  });
});
