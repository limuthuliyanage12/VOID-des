/*
 * Koko buy now, pay later. Three interest-free instalments; VOID is paid in full once Koko approves the plan.
 * Endpoint paths and payload formats come from the Koko merchant pack, which the team still has to request.
 * Everything Koko-specific sits behind this interface, so only the 'http' driver changes when the pack arrives.
 */
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { env } from '../config/env.js';
import { randomToken } from './crypto.js';

export interface KokoSessionInput {
  orderId: string; amountCents: number; currency: 'LKR';
  buyer: { name: string; email: string; mobile: string };
  returnUrl: string; cancelUrl: string; responseUrl: string;
}
export interface KokoCallback { orderId: string; kokoRef: string; paymentId: string; status: 'approved' | 'declined' | 'pending'; amountCents: number }
export interface KokoClient {
  readonly name: 'mock' | 'http';
  createSession(i: KokoSessionInput): Promise<{ redirectUrl: string; kokoRef: string }>;
  /** Checks the callback signature with Koko's public key. */
  verifyCallback(rawBody: string, signature: string): boolean;
  parseCallback(body: Record<string, unknown>): KokoCallback;
  getPlan(kokoRef: string): Promise<{ status: 'pending approval' | 'active' | 'completed' | 'failed'; received: number }>;
  refund(kokoRef: string, amountCents: number): Promise<{ ok: boolean; ref: string; error?: string }>;
}

const sign = (privateKeyPem: string, data: string) => createSign('RSA-SHA256').update(data).end().sign(privateKeyPem, 'base64');
const verify = (publicKeyPem: string, data: string, sig: string) => {
  try { return createVerify('RSA-SHA256').update(data).end().verify(publicKeyPem, sig, 'base64'); } catch { return false; }
};

const parse = (b: Record<string, unknown>): KokoCallback => ({
  orderId: String(b.orderId ?? b.order_id ?? ''),
  kokoRef: String(b.kokoRef ?? b.trnId ?? b.reference ?? ''),
  paymentId: String(b.paymentId ?? b.trnId ?? b.kokoRef ?? ''),
  status: (['approved', 'declined', 'pending'].includes(String(b.status)) ? b.status : String(b.status) === 'SUCCESS' ? 'approved' : 'declined') as KokoCallback['status'],
  amountCents: Math.round(Number(b.amount ?? 0) * 100),
});

/* ---------- Mock driver: development and tests. It signs callbacks with its own key pair. ---------- */
class MockKoko implements KokoClient {
  readonly name = 'mock' as const;
  readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  plans = new Map<string, { status: 'pending approval' | 'active' | 'completed' | 'failed'; received: number }>();
  async createSession(i: KokoSessionInput) {
    const kokoRef = 'KOKO-' + randomToken(9);
    this.plans.set(kokoRef, { status: 'pending approval', received: 0 });
    return { kokoRef, redirectUrl: `${env.apiPublicUrl}/api/v1/dev/koko/approve?ref=${encodeURIComponent(kokoRef)}&order=${encodeURIComponent(i.orderId)}&amount=${i.amountCents}&return=${encodeURIComponent(i.returnUrl)}` };
  }
  verifyCallback(raw: string, sig: string) { return verify(this.keys.publicKey, raw, sig); }
  parseCallback = parse;
  /** Signs a callback the way Koko would. Demo and tests only. */
  signedCallback(cb: { orderId: string; kokoRef: string; status: 'approved' | 'declined'; amountCents: number }) {
    const body = JSON.stringify({ orderId: cb.orderId, kokoRef: cb.kokoRef, paymentId: cb.kokoRef, status: cb.status, amount: (cb.amountCents / 100).toFixed(2) });
    if (cb.status === 'approved') this.plans.set(cb.kokoRef, { status: 'active', received: 1 });
    return { body, signature: sign(this.keys.privateKey, body) };
  }
  async getPlan(ref: string) { return this.plans.get(ref) ?? { status: 'failed' as const, received: 0 }; }
  async refund(ref: string) { return { ok: true, ref: `SIM-KOKO-REFUND-${ref}` }; }
}

/* ---------- HTTP driver: sandbox qaapi.paykoko.com, live prodapi.paykoko.com. Paths to confirm against the merchant pack. ---------- */
const KOKO_PATHS = { createOrder: '/api/merchants/orderCreate', orderStatus: '/api/merchants/orderStatus', refund: '/api/merchants/refund' } as const;
class HttpKoko implements KokoClient {
  readonly name = 'http' as const;
  base = env.koko.sandbox ? 'https://qaapi.paykoko.com' : 'https://prodapi.paykoko.com';
  private async call(path: string, payload: Record<string, unknown>) {
    const body = JSON.stringify({ ...payload, _mId: env.koko.merchantId });
    const res = await fetch(this.base + path, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': env.koko.apiKey, 'X-Signature': sign(env.koko.privateKey, body) },
      body,
    });
    if (!res.ok) throw new Error(`Koko ${path} returned ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
  async createSession(i: KokoSessionInput) {
    const out = await this.call(KOKO_PATHS.createOrder, {
      _orderId: i.orderId, _amount: (i.amountCents / 100).toFixed(2), _currency: i.currency,
      _firstName: i.buyer.name.split(' ')[0], _lastName: i.buyer.name.split(' ').slice(1).join(' '), _email: i.buyer.email, _mobileNo: i.buyer.mobile,
      _returnUrl: i.returnUrl, _cancelUrl: i.cancelUrl, _responseUrl: i.responseUrl, _pluginName: 'void', _pluginVersion: '1.0.0', _description: `VOID order ${i.orderId}`,
    });
    return { redirectUrl: String(out.redirectUrl ?? out.paymentUrl ?? ''), kokoRef: String(out.trnId ?? out.reference ?? i.orderId) };
  }
  verifyCallback(raw: string, sig: string) { return !!env.koko.publicKey && verify(env.koko.publicKey, raw, sig); }
  parseCallback = parse;
  async getPlan(ref: string) {
    const out = await this.call(KOKO_PATHS.orderStatus, { _trnId: ref });
    const s = String(out.status ?? '').toLowerCase();
    return { status: (s.includes('complete') ? 'completed' : s.includes('active') || s.includes('success') ? 'active' : s.includes('fail') ? 'failed' : 'pending approval') as 'completed' | 'active' | 'failed' | 'pending approval', received: Number(out.instalmentsPaid ?? 0) };
  }
  async refund(ref: string, amountCents: number) {
    try { const out = await this.call(KOKO_PATHS.refund, { _trnId: ref, _amount: (amountCents / 100).toFixed(2) }); return { ok: true, ref: String(out.refundId ?? ref) }; }
    catch (e) { return { ok: false, ref: '', error: (e as Error).message }; }
  }
}

let client: KokoClient | null = null;
export const koko = (): KokoClient => (client ??= env.koko.driver === 'http' ? new HttpKoko() : new MockKoko());
export const mockKoko = (): MockKoko | null => { const k = koko(); return k instanceof MockKoko ? k : null; };
