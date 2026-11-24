/* Money is integer LKR cents everywhere. Format only at the edge. */

export const CENTS = 100;

export const rupees = (lkr: number): number => {
  if (!Number.isFinite(lkr)) throw new TypeError('rupees() needs a finite number');
  return Math.round(lkr * CENTS);
};

export const toRupees = (cents: number): number => cents / CENTS;

/** Round a cents amount to the nearest whole rupee (half away from zero for positives). */
export const roundToRupee = (cents: number): number => Math.round(cents / CENTS) * CENTS;

/** "LKR 9,000". No decimals, as the site shows money. */
export const formatLKR = (cents: number): string =>
  'LKR ' + Math.round(cents / CENTS).toLocaleString('en-US');

/** "LKR 16.58M" for big console numbers, otherwise the plain form. */
export const formatLKRShort = (cents: number): string => {
  const r = cents / CENTS;
  return r >= 1e6 ? `LKR ${(r / 1e6).toFixed(2)}M` : formatLKR(cents);
};

/** Booking fee percent is 0 to 15 in 0.5 steps. Work in basis points so 5.5% stays exact. */
export const feeBasisPoints = (feePercent: number): number => Math.round(feePercent * 100);

export interface OrderMaths {
  subtotalCents: number;
  feePercent: number;
  feeCents: number;
  totalCents: number;
}

/**
 * Subtotal is quantity times unit price (or the table's minimum spend, qty 1).
 * The fee is the platform percent, rounded to the nearest rupee. Total is subtotal plus fee.
 */
export const calcOrder = ({ qty, unitCents, feePercent }: { qty: number; unitCents: number; feePercent: number }): OrderMaths => {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError('qty must be a positive integer');
  if (!Number.isInteger(unitCents) || unitCents < 0) throw new RangeError('unitCents must be a non-negative integer');
  const subtotalCents = qty * unitCents;
  const bp = feeBasisPoints(feePercent);
  const feeCents = Math.round((subtotalCents * bp) / 1_000_000) * CENTS;
  return { subtotalCents, feePercent, feeCents, totalCents: subtotalCents + feeCents };
};

export interface SplitMaths {
  size: number;
  shareCents: number;
  leadShareCents: number;
}

/**
 * Each share is the total over the group size in whole rupees.
 * Any rounding remainder goes on the lead's share, so the shares always add up to the total.
 */
export const splitShares = (totalCents: number, size: number): SplitMaths => {
  if (!Number.isInteger(size) || size < 2 || size > 6) throw new RangeError('group size must be 2 to 6');
  const totalRupees = Math.round(totalCents / CENTS);
  const base = Math.floor(totalRupees / size);
  const remainder = totalRupees - base * size;
  return { size, shareCents: base * CENTS, leadShareCents: (base + remainder) * CENTS };
};

export const shareAmounts = (s: SplitMaths): number[] =>
  Array.from({ length: s.size }, (_, i) => (i === 0 ? s.leadShareCents : s.shareCents));

/** Koko: a third today, then two monthly payments. Any remainder sits on the first instalment. */
export const kokoInstalments = (totalCents: number, n = 3): number[] => {
  const totalRupees = Math.round(totalCents / CENTS);
  const base = Math.floor(totalRupees / n);
  const first = totalRupees - base * (n - 1);
  return [first, ...Array.from({ length: n - 1 }, () => base)].map((r) => r * CENTS);
};

/** PayHere wants the amount with two decimals and no thousands separator. */
export const payhereAmount = (cents: number): string => (cents / CENTS).toFixed(2);
