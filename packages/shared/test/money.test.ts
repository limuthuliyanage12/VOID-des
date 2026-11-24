import { describe, expect, it } from 'vitest';
import { calcOrder, formatLKR, kokoInstalments, payhereAmount, rupees, shareAmounts, splitShares } from '../src/money.js';
import { formatDate, formatTime, nextColomboTime, parseColombo } from '../src/dates.js';

describe('order maths', () => {
  it('matches the prototype: 2 × Phase 3 at 5% is LKR 18,900', () => {
    const o = calcOrder({ qty: 2, unitCents: rupees(9000), feePercent: 5 });
    expect(o).toEqual({ subtotalCents: 1_800_000, feePercent: 5, feeCents: 90_000, totalCents: 1_890_000 });
  });

  it('charges the table minimum spend once: Gold at 5% is LKR 105,000', () => {
    expect(calcOrder({ qty: 1, unitCents: rupees(100_000), feePercent: 5 }).totalCents).toBe(rupees(105_000));
  });

  it('rounds the fee to the nearest rupee', () => {
    // 3,333 × 5.5% = 183.315 → 183
    expect(calcOrder({ qty: 1, unitCents: rupees(3333), feePercent: 5.5 }).feeCents).toBe(rupees(183));
    // 7,500 × 0.5% = 37.5 → 38
    expect(calcOrder({ qty: 1, unitCents: rupees(7500), feePercent: 0.5 }).feeCents).toBe(rupees(38));
  });

  it('allows a zero fee and rejects bad quantities', () => {
    expect(calcOrder({ qty: 3, unitCents: 100, feePercent: 0 }).feeCents).toBe(0);
    expect(() => calcOrder({ qty: 0, unitCents: 100, feePercent: 5 })).toThrow();
    expect(() => calcOrder({ qty: 1.5, unitCents: 100, feePercent: 5 })).toThrow();
  });
});

describe('split shares', () => {
  it('splits evenly when it can', () => {
    expect(splitShares(rupees(37_800), 4)).toEqual({ size: 4, shareCents: rupees(9450), leadShareCents: rupees(9450) });
    expect(splitShares(rupees(105_000), 6).shareCents).toBe(rupees(17_500));
  });

  it('puts the remainder on the lead and always adds up', () => {
    const s = splitShares(rupees(28_351), 3);
    expect(s.shareCents).toBe(rupees(9450));
    expect(s.leadShareCents).toBe(rupees(9451));
    expect(shareAmounts(s).reduce((a, b) => a + b, 0)).toBe(rupees(28_351));
    for (let total = 1000; total < 1100; total++) for (let n = 2; n <= 6; n++) {
      expect(shareAmounts(splitShares(rupees(total), n)).reduce((a, b) => a + b, 0)).toBe(rupees(total));
    }
  });

  it('only allows groups of 2 to 6', () => {
    expect(() => splitShares(100, 1)).toThrow();
    expect(() => splitShares(100, 7)).toThrow();
  });
});

describe('formatting', () => {
  it('formats money the way the site does', () => {
    expect(formatLKR(rupees(16_578_000))).toBe('LKR 16,578,000');
    expect(payhereAmount(rupees(18_900))).toBe('18900.00');
  });

  it('splits Koko into three, remainder first', () => {
    expect(kokoInstalments(rupees(18_900))).toEqual([rupees(6300), rupees(6300), rupees(6300)]);
    expect(kokoInstalments(rupees(1000))).toEqual([rupees(334), rupees(333), rupees(333)]);
  });

  it('handles Colombo time', () => {
    const gates = parseColombo('2027-02-27T16:00');
    expect(gates.toISOString()).toBe('2027-02-27T10:30:00.000Z');
    expect(formatDate(gates)).toBe('27 Feb 2027');
    expect(formatDate(gates, true)).toBe('Saturday 27 Feb 2027');
    expect(formatTime(gates)).toBe('4 pm');
    expect(nextColomboTime(8, 0, Date.parse('2027-02-27T01:00:00Z')).toISOString()).toBe('2027-02-27T02:30:00.000Z');
    expect(nextColomboTime(8, 0, Date.parse('2027-02-27T03:00:00Z')).toISOString()).toBe('2027-02-28T02:30:00.000Z');
  });
});
