/* Times are stored in UTC. Display and event-day logic use Asia/Colombo (UTC+05:30, no daylight saving). */

export const TIME_ZONE = 'Asia/Colombo';
export const COLOMBO_OFFSET_MIN = 330;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface ColomboParts { y: number; m: number; d: number; h: number; min: number; dow: number }

/** Wall-clock parts in Colombo for a UTC instant. */
export const colomboParts = (at: Date | number | string): ColomboParts => {
  const t = new Date(at).getTime() + COLOMBO_OFFSET_MIN * 60_000;
  const x = new Date(t);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes(), dow: x.getUTCDay() };
};

/** The UTC instant for a Colombo wall-clock time. */
export const fromColombo = (y: number, m: number, d: number, h = 0, min = 0): Date =>
  new Date(Date.UTC(y, m - 1, d, h, min) - COLOMBO_OFFSET_MIN * 60_000);

/** "2027-02-27T16:00" in Colombo time to a UTC Date. */
export const parseColombo = (local: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local);
  if (!m) throw new RangeError(`Not a Colombo date: ${local}`);
  return fromColombo(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
};

/** "27 Feb 2027", or "Saturday 27 Feb 2027" when long. */
export const formatDate = (at: Date | number | string, long = false): string => {
  const p = colomboParts(at);
  const s = `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
  return long ? `${DAYS[p.dow]} ${s}` : s;
};

/** "4 pm", "9:30 am". */
export const formatTime = (at: Date | number | string): string => {
  const p = colomboParts(at);
  const ap = p.h < 12 ? 'am' : 'pm';
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return p.min ? `${h12}:${String(p.min).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
};

/** "2027-02" in Colombo time, used by the month filter. */
export const colomboMonthKey = (at: Date | number | string): string => {
  const p = colomboParts(at);
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
};

/** "2027-02-27" in Colombo time. */
export const colomboDayKey = (at: Date | number | string): string => {
  const p = colomboParts(at);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
};

/** The next UTC instant at h:min Colombo time, strictly after `from`. */
export const nextColomboTime = (h: number, min: number, from: Date | number = Date.now()): Date => {
  const p = colomboParts(from);
  let at = fromColombo(p.y, p.m, p.d, h, min);
  if (at.getTime() <= new Date(from).getTime()) at = new Date(at.getTime() + 86_400_000);
  return at;
};

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const DAY = 86_400_000;
