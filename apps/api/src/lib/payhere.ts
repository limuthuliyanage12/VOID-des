/*
 * PayHere Checkout API. The browser posts our fields to PayHere; PayHere posts the result to notify_url.
 * The hash is always built here, never in the browser.
 *   hash   = UPPER(MD5(merchant_id + order_id + amount + currency + UPPER(MD5(secret))))
 *   md5sig = UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(MD5(secret))))
 */
import { createHash } from 'node:crypto';
import { payhereAmount } from '@void/shared';
import { env } from '../config/env.js';
import { safeEqual } from './crypto.js';
import { log } from './log.js';

const md5u = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();

export const CHECKOUT_URL = { sandbox: 'https://sandbox.payhere.lk/pay/checkout', live: 'https://www.payhere.lk/pay/checkout' } as const;
const API_BASE = { sandbox: 'https://sandbox.payhere.lk', live: 'https://www.payhere.lk' } as const;
export const checkoutUrl = () => (env.payhere.sandbox ? CHECKOUT_URL.sandbox : CHECKOUT_URL.live);

export const checkoutHash = (o: { merchantId: string; secret: string; orderId: string; amount: string; currency: string }) =>
  md5u(o.merchantId + o.orderId + o.amount + o.currency + md5u(o.secret));

export const notifySig = (o: { merchantId: string; secret: string; orderId: string; amount: string; currency: string; statusCode: string }) =>
  md5u(o.merchantId + o.orderId + o.amount + o.currency + o.statusCode + md5u(o.secret));

export interface CheckoutInput {
  orderId: string; amountCents: number; items: string;
  buyer: { name: string; email: string; mobile: string };
  returnUrl: string; cancelUrl: string; custom1?: string; custom2?: string;
}

export const buildCheckout = (i: CheckoutInput) => {
  const amount = payhereAmount(i.amountCents);
  const [first, ...rest] = i.buyer.name.trim().split(/\s+/);
  const fields: Record<string, string> = {
    merchant_id: env.payhere.merchantId,
    return_url: i.returnUrl,
    cancel_url: i.cancelUrl,
    notify_url: `${env.apiPublicUrl}/api/v1/webhooks/payhere`,
    order_id: i.orderId,
    items: i.items.slice(0, 100),
    currency: 'LKR',
    amount,
    first_name: first,
    last_name: rest.join(' ') || first,
    email: i.buyer.email,
    phone: i.buyer.mobile,
    address: 'Not collected',
    city: 'Colombo',
    country: 'Sri Lanka',
    custom_1: i.custom1 ?? '',
    custom_2: i.custom2 ?? '',
  };
  fields.hash = checkoutHash({ merchantId: env.payhere.merchantId, secret: env.payhere.merchantSecret, orderId: i.orderId, amount, currency: 'LKR' });
  return { provider: 'payhere' as const, action: checkoutUrl(), method: 'POST' as const, fields };
};

export type PayHereStatus = 'success' | 'pending' | 'cancelled' | 'failed' | 'charged back';
export const STATUS_MAP: Record<string, PayHereStatus> = { '2': 'success', '0': 'pending', '-1': 'cancelled', '-2': 'failed', '-3': 'charged back' };

export interface NotifyBody {
  merchant_id: string; order_id: string; payment_id: string; payhere_amount: string; payhere_currency: string;
  status_code: string; md5sig: string; method?: string; status_message?: string; [k: string]: unknown;
}

/** True only when the signature matches our merchant. The caller still checks status, amount and currency. */
export const verifyNotify = (b: Partial<NotifyBody>): boolean => {
  if (!b.merchant_id || !b.order_id || !b.payhere_amount || !b.payhere_currency || b.status_code == null || !b.md5sig) return false;
  if (b.merchant_id !== env.payhere.merchantId) return false;
  const expected = notifySig({ merchantId: b.merchant_id, secret: env.payhere.merchantSecret, orderId: b.order_id, amount: b.payhere_amount, currency: b.payhere_currency, statusCode: String(b.status_code) });
  return safeEqual(expected, String(b.md5sig).toUpperCase());
};

/** Builds a correctly signed notify body. Used by tests and the demo payment simulator only. */
export const signedNotify = (o: { orderId: string; amountCents: number; statusCode?: string; paymentId?: string; method?: string }): NotifyBody => {
  const amount = payhereAmount(o.amountCents), statusCode = o.statusCode ?? '2';
  return {
    merchant_id: env.payhere.merchantId, order_id: o.orderId, payment_id: o.paymentId ?? String(320000000000 + Math.floor(Math.random() * 1e9)),
    payhere_amount: amount, payhere_currency: 'LKR', status_code: statusCode, method: o.method ?? 'VISA', status_message: statusCode === '2' ? 'Successfully completed the payment.' : 'Not completed',
    md5sig: notifySig({ merchantId: env.payhere.merchantId, secret: env.payhere.merchantSecret, orderId: o.orderId, amount, currency: 'LKR', statusCode }),
  };
};

/**
 * Refund through PayHere's Merchant API (OAuth client credentials).
 * Without API credentials outside production, the refund is recorded as simulated so the flows can be tested.
 */
export const refundPayment = async (paymentId: string, description: string): Promise<{ ok: boolean; ref: string; simulated: boolean; error?: string }> => {
  if (!env.payhere.appId || !env.payhere.appSecret) {
    if (env.isProd) return { ok: false, ref: '', simulated: false, error: 'PAYHERE_APP_ID and PAYHERE_APP_SECRET are not set. Refund by hand in the PayHere portal.' };
    return { ok: true, ref: `SIM-REFUND-${paymentId}`, simulated: true };
  }
  const base = env.payhere.sandbox ? API_BASE.sandbox : API_BASE.live;
  try {
    const tokenRes = await fetch(`${base}/merchant/v1/oauth/token`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${env.payhere.appId}:${env.payhere.appSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials', signal: AbortSignal.timeout(10_000),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return { ok: false, ref: '', simulated: false, error: 'PayHere did not return an access token' };
    const res = await fetch(`${base}/merchant/v1/payment/refund`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_id: paymentId, description: description.slice(0, 120) }), signal: AbortSignal.timeout(10_000),
    });
    const out = (await res.json()) as { status?: number; msg?: string; data?: unknown };
    if (out.status === 1) return { ok: true, ref: `PH-REFUND-${paymentId}`, simulated: false };
    return { ok: false, ref: '', simulated: false, error: out.msg || 'PayHere refused the refund' };
  } catch (e) {
    log.error('payhere refund failed', { paymentId, error: e });
    return { ok: false, ref: '', simulated: false, error: (e as Error).message };
  }
};
