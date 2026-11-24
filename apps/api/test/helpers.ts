import request from 'supertest';
import { createApp } from '../src/app.js';
import { Event, Tier, User } from '../src/db/models/index.js';
import { jobs } from '../src/lib/jobs.js';
import { signedNotify } from '../src/lib/payhere.js';
import { signAccess } from '../src/lib/tokens.js';

export const app = createApp();
export const api = () => request(app);

export const tokenFor = async (email: string, mfa = true) => {
  const u = await User.findOne({ email }).lean();
  if (!u) throw new Error(`no user ${email}`);
  return signAccess({ sub: String(u._id), role: u.role, eid: u.assignedEventId ? String(u.assignedEventId) : null, mfa, name: u.name, email: u.email });
};
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export const flagship = async () => (await Event.findOne({ slug: 'void-2027' }).lean())!;
export const phase3 = async () => { const e = await flagship(); return (await Tier.findOne({ eventId: e._id, name: 'Phase 3' }).lean())!; };

export const buyer = { name: 'Test Buyer', email: 'buyer@example.com', mobile: '0771234567' };

/** Hold then checkout. Returns the checkout body plus the hold. */
export const startOrder = async (opts: { qty?: number; split?: number; payMethod?: 'card' | 'koko'; presaleCode?: string; email?: string } = {}) => {
  const e = await flagship(), t = await phase3();
  const h = await api().post('/api/v1/holds').send({ kind: 'tier', eventId: 'void-2027', tierId: String(t._id), qty: opts.qty ?? 2, ...(opts.presaleCode ? { presaleCode: opts.presaleCode } : {}) });
  if (h.status !== 201) throw new Error(`hold failed ${h.status} ${JSON.stringify(h.body)}`);
  const c = await api().post('/api/v1/checkout').send({ holdId: h.body.id, holdSecret: h.body.secret, buyer: { ...buyer, email: opts.email ?? buyer.email }, payMethod: opts.payMethod ?? 'card', acceptTerms: true, ...(opts.split ? { split: { size: opts.split, friends: Array.from({ length: opts.split - 1 }, (_, i) => ({ name: `Friend Number${i + 1}`, email: `friend${i + 1}@example.com` })) } } : {}) });
  if (c.status !== 201) throw new Error(`checkout failed ${c.status} ${JSON.stringify(c.body)}`);
  return { hold: h.body, checkout: c.body, event: e, tier: t };
};

/** Posts a correctly signed PayHere notify through the real webhook route, then waits for the job. */
export const payhereNotify = async (orderId: string, amountCents: number, o: { statusCode?: string; paymentId?: string } = {}) => {
  const body = signedNotify({ orderId, amountCents, ...o });
  const res = await api().post('/api/v1/webhooks/payhere').type('form').send(body);
  await jobs.flush();
  return { res, body };
};
