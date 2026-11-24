/* CSV with proper quoting, and a guard against spreadsheet formula injection. */
export interface Col<T> { key: keyof T | ((r: T) => unknown); label: string }

const cell = (v: unknown): string => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = <T>(rows: T[], cols: Col<T>[]): string =>
  [cols.map((c) => cell(c.label)).join(','), ...rows.map((r) => cols.map((c) => cell(typeof c.key === 'function' ? c.key(r) : r[c.key])).join(','))].join('\r\n') + '\r\n';

export const rupeesCell = (cents: number) => Math.round(cents / 100);
