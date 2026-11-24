import { describe, expect, it } from 'vitest';
import { checkoutHash, notifySig, signedNotify, verifyNotify } from '../src/lib/payhere.js';
import { mockKoko } from '../src/lib/koko.js';
import { jobs } from '../src/lib/jobs.js';
import { readOutbox } from '../src/lib/notify.js';
import { AuditLog, Event, Hold, KokoPlan, Order, Payment, SplitGroup, SplitShare, Ticket, Tier } from '../src/db/models/index.js';
import { leftOf } from '../src/modules/tiers/inventory.js';
import { api, bearer, buyer, payhereNotify, phase3, startOrder, tokenFor } from './helpers.js';

describe('PayHere signatures', () => {
  it('builds the hash the way the PayHere docs describe', () => {
    /* UPPER(MD5(merchant_id + order_id + amount + currency + UPPER(MD5(secret)))) */
    const h = checkoutHash({ merchantId: '1211149', secret: 'secret', orderId: 'ItemNo12345', amount: '1000.00', currency: 'LKR' });
    expect(h).toMatch(/^[0-9A-F]{32}$/);
    expect(h).toBe(checkoutHash({ merchantId: '1211149', secret: 'secret', orderId: 'ItemNo12345', amount: '1000.00', currency: 'LKR' }));
    expect(h).not.toBe(checkoutHash({ merchantId: '1211149', secret: 'secret', orderId: 'ItemNo12345', amount: '1000.01', currency: 'LKR' }));
  });

  it('accepts a correct md5sig and rejects forged ones', () => {
    const good = signedNotify({ orderId: 'VOID-2700001', amountCents: 1_890_000 });
    expect(verifyNotify(good)).toBe(true);
    expect(verifyNotify({ ...good, payhere_amount: '1.00' })).toBe(false);
    expect(verifyNotify({ ...good, status_code: '2', md5sig: notifySig({ merchantId: good.merchant_id, secret: 'not-the-secret', orderId: good.order_id, amount: good.payhere_amount, currency: 'LKR', statusCode: '2' }) })).toBe(false);
    expect(verifyNotify({ ...good, merchant_id: '999' })).toBe(false);
    expect(verifyNotify({})).toBe(false);
  });
});

describe('card checkout', () => {
  it('returns PayHere fields with a server-made hash, and issues tickets only after a verified callback', async () => {
    const { checkout } = await startOrder({ qty: 2 });
    expect(checkout.order).toMatchObject({ status: 'pending', subtotalCents: 1_800_000, feeCents: 90_000, totalCents: 1_890_000, feePercent: 5 });
    expect(checkout.payment.action).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(checkout.payment.fields).toMatchObject({ amount: '18900.00', currency: 'LKR', order_id: checkout.order.code });
    expect(checkout.payment.fields.hash).toMatch(/^[0-9A-F]{32}$/);
    const code = checkout.order.code;
    expect(await Ticket.countDocuments({ orderCode: code })).toBe(0);

    const forged = await api().post('/api/v1/webhooks/payhere').type('form').send({ ...signedNotify({ orderId: code, amountCents: 1_890_000 }), md5sig: 'A'.repeat(32) });
    expect(forged.status).toBe(400);
    expect(await Order.findOne({ code }).lean()).toMatchObject({ status: 'pending' });

    const { res, body } = await payhereNotify(code, 1_890_000);
    expect(res.status).toBe(200);
    const o = await Order.findOne({ code }).lean();
    expect(o!.status).toBe('paid');
    expect(await Ticket.countDocuments({ orderCode: code, status: 'valid' })).toBe(2);
    expect(readOutbox(10).some((m) => m.subject === 'Your tickets for VOID 2027' && m.attachments?.length === 2)).toBe(true);

    /* A repeat of the same callback is ignored. */
    const again = await api().post('/api/v1/webhooks/payhere').type('form').send(body);
    await jobs.flush();
    expect(again.text).toBe('repeat ignored');
    expect(await Payment.countDocuments({ orderId: o!._id })).toBe(1);
    expect(await Ticket.countDocuments({ orderCode: code })).toBe(2);
    const t = await phase3();
    expect(t.sold).toBe(244);
    expect(leftOf(t)).toBe(156);
    const ev = await Event.findOne({ slug: 'void-2027' }).lean();
    expect(ev!.stats.sold).toBe(1844);

    /* The buyer reads it with the view token from checkout. */
    const view = await api().get(`/api/v1/orders/${code}?t=${checkout.viewToken}`);
    expect(view.status).toBe(200);
    expect(view.body.tickets).toHaveLength(2);
    expect(view.body.tickets[0].qr).toMatch(/^V1\./);
    expect((await api().get(`/api/v1/orders/${code}?t=wrong`)).status).toBe(404);
    const pdf = await api().get(`/api/v1/tickets/${view.body.tickets[0].id}/pdf?t=${checkout.viewToken}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('does not fulfil on a pending or failed status, nor on a wrong amount', async () => {
    const { checkout } = await startOrder({ qty: 1 });
    const code = checkout.order.code;
    await payhereNotify(code, checkout.order.totalCents, { statusCode: '0', paymentId: 'P-PENDING-1' });
    expect((await Order.findOne({ code }).lean())!.status).toBe('pending');
    await payhereNotify(code, 100, { paymentId: 'P-WRONG-AMOUNT' });
    expect((await Order.findOne({ code }).lean())!.status).toBe('pending');
    expect((await Payment.findOne({ providerPaymentId: 'P-WRONG-AMOUNT' }).lean())!.needsAttention).toMatch(/does not match/);
    /* The pending payment later succeeds under the same payment id. */
    await payhereNotify(code, checkout.order.totalCents, { statusCode: '2', paymentId: 'P-PENDING-1' });
    expect((await Order.findOne({ code }).lean())!.status).toBe('paid');
  });

  it('a late payment after the hold lapsed still sells if there is room', async () => {
    const { checkout, hold } = await startOrder({ qty: 1 });
    await Hold.updateOne({ _id: hold.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await jobs.runNow('expireHold', { holdId: hold.id });
    expect((await Order.findOne({ code: checkout.order.code }).lean())!.status).toBe('cancelled');
    await payhereNotify(checkout.order.code, checkout.order.totalCents);
    expect((await Order.findOne({ code: checkout.order.code }).lean())!.status).toBe('paid');
  });

  it('uses Idempotency-Key to replay a retried checkout', async () => {
    const t = await phase3();
    const h = await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 1 });
    const body = { holdId: h.body.id, holdSecret: h.body.secret, buyer, payMethod: 'card', acceptTerms: true };
    const a = await api().post('/api/v1/checkout').set('Idempotency-Key', 'retry-key-0001').send(body);
    const b = await api().post('/api/v1/checkout').set('Idempotency-Key', 'retry-key-0001').send(body);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.order.code).toBe(a.body.order.code);
  });

  it('staff accounts cannot buy', async () => {
    const t = await phase3();
    const tok = await tokenFor('nimal.perera@organizers.example.com');
    expect((await api().post('/api/v1/holds').set(bearer(tok)).send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: 1 })).status).toBe(403);
  });
});

describe('booking fee', () => {
  it('a fee change applies to new orders only and writes the audit log', async () => {
    const before = await startOrder({ qty: 1 });
    const sup = await tokenFor('super@eventsbythevoid.lk');
    const r = await api().patch('/api/v1/super/settings/fees').set(bearer(sup)).send({ bookingFeePercent: 7.5 });
    expect(r.status).toBe(200);
    expect(r.body.example.feeCents).toBe(67_500);
    expect((await api().patch('/api/v1/super/settings/fees').set(bearer(sup)).send({ bookingFeePercent: 7.3 })).status).toBe(400);
    expect((await api().patch('/api/v1/super/settings/fees').set(bearer(sup)).send({ bookingFeePercent: 16 })).status).toBe(400);
    const after = await startOrder({ qty: 1 });
    expect(after.checkout.order).toMatchObject({ feePercent: 7.5, feeCents: 67_500, totalCents: 967_500 });
    expect((await Order.findOne({ code: before.checkout.order.code }).lean())!.feePercent).toBe(5);
    const a = await AuditLog.findOne({ action: 'Changed booking fee' }).lean();
    expect(a).toMatchObject({ before: { bookingFeePercent: 5 }, after: { bookingFeePercent: 7.5 } });
    await api().patch('/api/v1/super/settings/fees').set(bearer(sup)).send({ bookingFeePercent: 5 });
  });

  it('the audit log is append only', async () => {
    await expect(AuditLog.updateOne({}, { $set: { result: 'tampered' } })).rejects.toThrow(/append only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append only/);
  });
});

describe('split pay', () => {
  it('lead pays first, friends pay by link, tickets issue only when everyone has paid', async () => {
    const { checkout } = await startOrder({ qty: 4, split: 4 });
    const code = checkout.order.code;
    expect(checkout.order.split).toMatchObject({ size: 4, shareCents: 945_000, leadShareCents: 945_000 });
    expect(checkout.payment.fields).toMatchObject({ order_id: `${code}-S0`, amount: '9450.00' });
    const links: string[] = checkout.order.split.shares.filter((s: { index: number }) => s.index > 0).map((s: { link: string }) => s.link);
    expect(links).toHaveLength(3);
    const token = (l: string) => new URL(l).searchParams.get('split')!;

    /* A friend can't pay before the lead. */
    const early = await api().post(`/api/v1/split/${token(links[0])}/pay`).send({ name: 'Friend Number1', email: 'f1@example.com', mobile: '0771112223' });
    expect(early.body.code).toBe('LEAD_NOT_PAID');

    await payhereNotify(`${code}-S0`, 945_000);
    const g = await SplitGroup.findOne({ orderId: (await Order.findOne({ code }).lean())!._id }).lean();
    expect(g!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 47 * 3_600_000);
    expect((await Order.findOne({ code }).lean())!.status).toBe('split pending');
    expect(await Ticket.countDocuments({ orderCode: code })).toBe(0);
    expect(readOutbox(20).filter((m) => m.tag === 'split-invite').length).toBeGreaterThanOrEqual(3);

    const view = await api().get(`/api/v1/split/${token(links[0])}`);
    expect(view.body).toMatchObject({ share: { amountCents: 945_000, status: 'waiting' }, lead: 'Test', group: { size: 4, paid: 1, leadPaid: true } });

    for (const [i, l] of links.entries()) {
      const p = await api().post(`/api/v1/split/${token(l)}/pay`).send({ name: `Friend Number${i + 1}`, email: `f${i}@example.com`, mobile: '0771112223' });
      expect(p.status).toBe(200);
      await payhereNotify(p.body.payment.fields.order_id, 945_000);
      expect(await Ticket.countDocuments({ orderCode: code })).toBe(i < 2 ? 0 : 1);
    }
    expect((await Order.findOne({ code }).lean())!.status).toBe('paid');
    const tickets = await Ticket.find({ orderCode: code }).lean();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ kind: 'party', admits: 4 });
    /* A paid share's link is single use. */
    expect((await api().post(`/api/v1/split/${token(links[0])}/pay`).send({ name: 'Friend Number1', email: 'f1@example.com', mobile: '0771112223' })).status).toBe(410);
  });

  it('releases inventory and refunds paid shares if the group does not finish in 48 hours', async () => {
    const before = leftOf(await phase3());
    const { checkout } = await startOrder({ qty: 3, split: 3 });
    const code = checkout.order.code;
    await payhereNotify(`${code}-S0`, checkout.order.split.leadShareCents);
    expect(leftOf(await phase3())).toBe(before - 3);
    const o = await Order.findOne({ code }).lean();
    await SplitGroup.updateOne({ orderId: o!._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await jobs.runNow('sweep');
    expect((await SplitGroup.findOne({ orderId: o!._id }).lean())!.status).toBe('released');
    expect((await Order.findOne({ code }).lean())!.status).toBe('refunded');
    expect(await SplitShare.countDocuments({ orderId: o!._id, status: 'refunded' })).toBe(1);
    expect((await Payment.findOne({ orderId: o!._id }).lean())!.status).toBe('refunded');
    expect(leftOf(await phase3())).toBe(before);
    expect(readOutbox(20).some((m) => m.tag === 'split-released')).toBe(true);
  });

  it('organizer can extend once and release a seeded group (which reverses its counted sale)', async () => {
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const base = '/api/v1/admin/events/void-2027';
    const list = await api().get(`${base}/splits`).set(bearer(org));
    expect(list.body.kpis.openGroups).toBeGreaterThanOrEqual(3);
    const sp037 = list.body.groups.find((g: { code: string }) => g.code === 'SP-037');
    expect(sp037).toMatchObject({ paid: 4, size: 6, warning: true });
    expect((await api().post(`${base}/splits/SP-037/extend`).set(bearer(org))).status).toBe(200);
    expect((await api().post(`${base}/splits/SP-037/extend`).set(bearer(org))).body.code).toBe('ALREADY_EXTENDED');

    const soldBefore = (await phase3()).sold;
    const rel = await api().post(`${base}/splits/SP-038/release`).set(bearer(org));
    expect(rel.body).toMatchObject({ code: 'SP-038', sharesRefunded: 2, refundedCents: 1_890_000 });
    expect((await phase3()).sold).toBe(soldBefore - 4);
    const g = await api().post(`${base}/splits/SP-037/release`).set(bearer(org));
    expect(g.body.sharesRefunded).toBe(4);
    const t = await api().get('/api/v1/events/void-2027/tables');
    expect(t.body.tables.find((x: { code: string }) => x.code === 'G06').status).toBe('available');
  });
});

describe('Koko', () => {
  it('redirects to Koko, and issues tickets once a signed approval arrives', async () => {
    const { checkout } = await startOrder({ qty: 2, payMethod: 'koko' });
    expect(checkout.payment.provider).toBe('koko');
    expect(checkout.payment.redirectUrl).toContain('/dev/koko/approve');
    const code = checkout.order.code;
    const plan = await KokoPlan.findOne({ orderId: (await Order.findOne({ code }).lean())!._id }).lean();
    expect(plan!.status).toBe('pending approval');
    const k = mockKoko()!;

    const forged = await api().post('/api/v1/webhooks/koko').set('X-Koko-Signature', 'bm90LWEtc2ln').set('Content-Type', 'application/json').send(JSON.stringify({ orderId: code, kokoRef: plan!.kokoRef, status: 'approved', amount: '18900.00' }));
    expect(forged.status).toBe(400);

    const { body, signature } = k.signedCallback({ orderId: code, kokoRef: plan!.kokoRef, status: 'approved', amountCents: checkout.order.totalCents });
    const ok = await api().post('/api/v1/webhooks/koko').set('X-Koko-Signature', signature).set('Content-Type', 'application/json').send(body);
    await jobs.flush();
    expect(ok.status).toBe(200);
    expect((await Order.findOne({ code }).lean())!.status).toBe('paid');
    expect((await KokoPlan.findById(plan!._id).lean())!.status).toBe('active');
    const again = await api().post('/api/v1/webhooks/koko').set('X-Koko-Signature', signature).set('Content-Type', 'application/json').send(body);
    expect(again.text).toBe('repeat ignored');
    expect(await Ticket.countDocuments({ orderCode: code })).toBe(2);
  });
});

describe('refunds', () => {
  it('fan requests, organizer approves, tickets are void', async () => {
    const { checkout } = await startOrder({ qty: 2, email: 'refund.me@example.com' });
    await payhereNotify(checkout.order.code, checkout.order.totalCents);
    const req = await api().post(`/api/v1/orders/${checkout.order.code}/refund-request?t=${checkout.viewToken}`).send({ reason: 'Cannot make it' });
    expect(req.status).toBe(201);
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const list = await api().get('/api/v1/admin/events/void-2027/refund-requests').set(bearer(org));
    const id = list.body.items.find((r: { orderCode: string }) => r.orderCode === checkout.order.code).id;
    const d = await api().patch('/api/v1/admin/events/void-2027/refund-requests').set(bearer(org)).send({ id, decision: 'approved' });
    expect(d.status).toBe(200);
    expect(d.body.refund).toMatchObject({ status: 'refunded', amountCents: checkout.order.totalCents });
    expect(await Ticket.countDocuments({ orderCode: checkout.order.code, status: 'void' })).toBe(2);
    expect((await Payment.findOne({ providerOrderId: checkout.order.code, status: 'refunded' }).lean())).toBeTruthy();
  });

  it('partial refund voids only the chosen ticket', async () => {
    const { checkout } = await startOrder({ qty: 2 });
    await payhereNotify(checkout.order.code, checkout.order.totalCents);
    const ts = await Ticket.find({ orderCode: checkout.order.code }).lean();
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const r = await api().post(`/api/v1/admin/events/void-2027/orders/${checkout.order.code}/refund`).set(bearer(org)).send({ ticketIds: [String(ts[0]._id)] });
    expect(r.body).toMatchObject({ status: 'partially refunded', amountCents: 945_000 });
    expect((await Ticket.findById(ts[1]._id).lean())!.status).toBe('valid');
  });

  it('comp tickets count against capacity and stop at 50', async () => {
    const org = await tokenFor('nimal.perera@organizers.example.com');
    const before = leftOf(await phase3());
    const r = await api().post('/api/v1/admin/events/void-2027/comps').set(bearer(org)).send({ name: 'Guest List', email: 'guest@example.com', qty: 2 });
    expect(r.status).toBe(201);
    expect(r.body.compsIssued).toBe(26);
    expect(leftOf(await phase3())).toBe(before - 2);
    expect((await api().post('/api/v1/admin/events/void-2027/comps').set(bearer(org)).send({ name: 'Guest List', email: 'guest@example.com', qty: 10 })).status).toBe(201);
    expect((await api().post('/api/v1/admin/events/void-2027/comps').set(bearer(org)).send({ name: 'Guest List', email: 'guest@example.com', qty: 10 })).status).toBe(201);
    const over = await api().post('/api/v1/admin/events/void-2027/comps').set(bearer(org)).send({ name: 'Guest List', email: 'guest@example.com', qty: 10 });
    expect(over.body.code).toBe('COMP_LIMIT');
    /* Comp holds convert straight away; none are left holding seats. */
    expect(await Hold.countDocuments({ label: /Comp/, status: 'active' })).toBe(0);
    expect(await Tier.countDocuments({ eventId: (await phase3()).eventId, held: { $lt: 0 } })).toBe(0);
  });
});
