/* Request schemas. The API validates every route with these, and the frontend can import the same types. */
import { z } from 'zod';
import {
  EVENT_STATUS, GATE_ROLES, GENRES, INVOICE_STATUS, LAYOUT_OBJECT_TYPES, MESSAGE_CHANNEL, MODEL_STATUS, NOTIFY_KIND,
  REFUND_STATUS, REGIONS, RULES, VIP_TIERS,
} from './constants.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be an id');
/** An event can be named by its id or its slug ("void-2027"). */
export const eventRef = z.string().min(1).max(80);
export const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
export const personName = z.string().trim().min(2, 'Enter your full name').max(80);
/** 9 to 18 digits, spaces, dashes and a leading + allowed. */
export const mobile = z.string().trim().refine((s) => /^\+?[\d\s-]+$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 9 && (s.match(/\d/g)?.length ?? 0) <= 18, 'Enter a mobile number of 9 to 18 digits');
export const password = z.string().min(6, 'Use at least 6 characters').max(200);
const lkr = z.number().int().nonnegative();
const cents = z.number().int().nonnegative();
const isoDate = z.coerce.date();

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  sort: z.string().trim().max(40).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

/* ---------- Auth ---------- */
export const signupBody = z.object({ name: personName, email, password, phone: mobile.optional(), marketingConsent: z.boolean().default(false) });
export const loginBody = z.object({ email, password: z.string().min(1).max(200), otp: z.string().regex(/^\d{6}$/).optional() });
export const googleBody = z.object({ code: z.string().min(1), state: z.string().min(1) });
export const totpVerifyBody = z.object({ otp: z.string().regex(/^\d{6}$/) });

/* ---------- Public ---------- */
export const eventsQuery = z.object({
  q: z.string().trim().max(120).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  city: z.string().trim().max(60).optional(),
  genre: z.enum(GENRES).optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  sort: z.enum(['date', 'price']).default('date'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});
export const notifyBody = z.object({ email, consent: z.literal(true, { errorMap: () => ({ message: 'Tick the box to agree' }) }), kind: z.enum(NOTIFY_KIND).optional() });
export const newsletterBody = z.object({ email, consent: z.literal(true, { errorMap: () => ({ message: 'Tick the box to agree' }) }) });
export const presaleBody = z.object({ code: z.string().trim().min(1).max(40) });

export const holdBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tier'), eventId: eventRef, tierId: objectId, qty: z.number().int().min(1).max(RULES.maxGaQty), presaleCode: z.string().trim().max(40).optional(), guestEmail: email.optional() }),
  z.object({ kind: z.literal('table'), eventId: eventRef, tableCode: z.string().regex(/^[GP]0[1-8]$/), vipTier: z.enum(VIP_TIERS), guestEmail: email.optional() }),
]);
export type HoldBody = z.infer<typeof holdBody>;

export const checkoutBody = z.object({
  holdId: objectId,
  holdSecret: z.string().min(16).max(128),
  buyer: z.object({ name: personName, email, mobile }),
  payMethod: z.enum(['card', 'koko']),
  split: z.object({
    size: z.number().int().min(RULES.minGroup).max(RULES.maxGroup),
    friends: z.array(z.object({ name: personName.optional(), email: email.optional() })).max(RULES.maxGroup - 1).optional(),
  }).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Agree to the terms to continue' }) }),
  marketingConsent: z.boolean().default(false),
  source: z.string().trim().max(60).optional(),
}).refine((b) => !(b.split && b.payMethod === 'koko'), { message: 'Split pay uses card for every share', path: ['payMethod'] });
export type CheckoutBody = z.infer<typeof checkoutBody>;

export const transferBody = z.object({ toName: personName, toEmail: email });
export const refundRequestBody = z.object({ reason: z.string().trim().min(3).max(500), ticketIds: z.array(objectId).optional() });

/* ---------- Organizer ---------- */
export const tierCreateBody = z.object({ name: z.string().trim().min(2).max(40), price: lkr.min(1), total: z.number().int().min(1).max(100_000), startsAt: isoDate.optional(), endsAt: isoDate.optional() });
export const tierPatchBody = z.object({ name: z.string().trim().min(2).max(40).optional(), price: lkr.min(1).optional(), total: z.number().int().min(1).max(100_000).optional(), startsAt: isoDate.optional(), endsAt: isoDate.optional() });
export const toggleBody = z.object({ on: z.boolean() });
export const presaleCreateBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,24}$/, 'Use 4 to 24 letters, digits or dashes'), price: lkr.min(1), limit: z.number().int().min(1).max(10_000) });
export const compBody = z.object({ name: personName, email, qty: z.number().int().min(1).max(10).default(1), note: z.string().max(200).optional() });
export const orderRefundBody = z.object({ ticketIds: z.array(objectId).optional(), reason: z.string().trim().max(300).optional() });
export const refundDecisionBody = z.object({ id: objectId, decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() });

export const layoutObject = z.object({
  type: z.enum(LAYOUT_OBJECT_TYPES),
  name: z.string().trim().min(1).max(40),
  x: z.number().min(0).max(100), y: z.number().min(0).max(100),
  w: z.number().min(0.5).max(100), h: z.number().min(0.5).max(100),
  capacity: z.number().int().min(0).max(100_000).optional(),
  tier: z.string().max(40).optional(),
});
export const layoutPutBody = z.object({ objects: z.array(layoutObject).max(500), widthM: z.number().positive().max(2000).optional(), depthM: z.number().positive().max(2000).optional() });

export const campaignBody = z.object({ name: z.string().trim().min(2).max(60), ref: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/) });
export const messageBody = z.object({
  channel: z.enum(MESSAGE_CHANNEL),
  audience: z.enum(['all', 'ga', 'vip', 'split pending']),
  subject: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(5000),
}).refine((m) => m.channel !== 'sms' || m.body.length <= RULES.smsMaxChars, { message: 'SMS must be 160 characters or fewer', path: ['body'] })
  .refine((m) => m.channel !== 'email' || !!m.subject, { message: 'Email needs a subject', path: ['subject'] });

export const gateStaffBody = z.object({ name: personName, mobile, email: email.optional(), role: z.enum(GATE_ROLES) });
export const gateStaffPatchBody = z.object({ id: objectId, gateAccess: z.boolean().optional(), boxOffice: z.boolean().optional(), role: z.enum(GATE_ROLES).optional() });
export const scanBody = z.object({ token: z.string().min(10).max(2000), deviceId: z.string().trim().min(1).max(80), gate: z.string().trim().max(40).optional(), scannedAt: isoDate.optional() });
export const scanBatchBody = z.object({ scans: z.array(scanBody.extend({ scannedAt: isoDate })).min(1).max(500) });
export const boxOfficeSaleBody = z.object({ tierId: objectId, qty: z.number().int().min(1).max(RULES.maxGaQty), name: personName, email: email.optional(), mobile: mobile.optional() });

export const invoiceBody = z.object({ billTo: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(300), amount: lkr.min(1), dueAt: isoDate, status: z.enum(INVOICE_STATUS).default('pending') });
export const detailsPatchBody = z.object({ name: z.string().trim().min(2).max(80).optional(), about: z.string().trim().max(2000).optional(), playlist: z.string().url().max(300).optional().or(z.literal('')), startsAt: isoDate.optional(), gatesAt: isoDate.optional(), endsAt: isoDate.optional() });
export const notificationsPatchBody = z.object({ orders: z.boolean().optional(), splitReminders: z.boolean().optional(), dailyDigest: z.boolean().optional() });
export const eventCreateBody = z.object({ name: z.string().trim().min(2).max(80), venueId: objectId, startsAt: isoDate, gatesAt: isoDate, endsAt: isoDate, genre: z.enum(GENRES), fromPrice: lkr.min(1), about: z.string().max(2000).optional() });

/* ---------- Super admin ---------- */
export const noteBody = z.object({ note: z.string().trim().max(500).optional() });
export const adminInviteBody = z.object({ name: personName, email, eventId: objectId });
export const venueBody = z.object({ name: z.string().trim().min(2).max(80), city: z.string().trim().min(2).max(60), capacity: z.number().int().min(1).max(200_000), region: z.enum(REGIONS), modelStatus: z.enum(MODEL_STATUS).default('none'), widthM: z.number().positive().optional(), depthM: z.number().positive().optional() });
export const feesBody = z.object({ bookingFeePercent: z.number().min(0).max(15).refine((n) => Number.isInteger(n * 2), 'Use 0.5 steps') });
export const settingsPatchBody = z.object({ platformName: z.string().trim().min(2).max(60).optional(), supportEmail: email.optional(), dataProtectionContact: z.string().trim().max(200).optional() });
export const markPaidBody = z.object({ bankRef: z.string().trim().min(3).max(60) });
export const privacyRequestBody = z.object({ kind: z.enum(['access', 'export', 'delete', 'correct']), email, details: z.string().max(1000).optional() });
export const privacyDecisionBody = z.object({ status: z.enum(['open', 'in progress', 'done', 'rejected']), note: z.string().max(500).optional() });
export const breachBody = z.object({ summary: z.string().trim().min(5).max(2000), detectedAt: isoDate, affected: z.number().int().min(0).default(0), reportedToAuthorityAt: isoDate.optional() });
export const eventStatusFilter = z.enum(EVENT_STATUS);
export const refundStatusFilter = z.enum(REFUND_STATUS);
export { cents };
