/* campaigns, messages, notifyList, newsletter, payouts, invoices */
import { Schema, model, type Types } from 'mongoose';
import { INVOICE_STATUS, MESSAGE_CHANNEL, NOTIFY_KIND, PAYOUT_STATUS } from '@void/shared';

const campaignSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  name: { type: String, required: true },
  /** Unique per event, and kept unique platform-wide so /r/{ref} is never ambiguous. */
  ref: { type: String, required: true, lowercase: true },
  clicks: { type: Number, default: 0 },
  sales: { type: Number, default: 0 },
  revenueCents: { type: Number, default: 0 },
}, { timestamps: true });
campaignSchema.index({ ref: 1 }, { unique: true });
campaignSchema.index({ eventId: 1, ref: 1 }, { unique: true });
export const Campaign = model('Campaign', campaignSchema);

const messageSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  channel: { type: String, enum: MESSAGE_CHANNEL, required: true },
  audience: { type: String, required: true },
  subject: String,
  body: { type: String, required: true },
  recipients: { type: Number, default: 0 },
  skippedNoConsent: { type: Number, default: 0 },
  costCents: { type: Number, default: 0 },
  status: { type: String, enum: ['queued', 'sending', 'sent', 'failed'], default: 'queued' },
  sentBy: { type: Schema.Types.ObjectId, ref: 'User' },
  sentAt: Date,
}, { timestamps: true });
messageSchema.index({ eventId: 1, createdAt: -1 });
export const Message = model('Message', messageSchema);

const notifySchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  email: { type: String, required: true, lowercase: true },
  consentAt: { type: Date, required: true },
  kind: { type: String, enum: NOTIFY_KIND, default: 'notify' },
  notifiedAt: Date,
}, { timestamps: true });
notifySchema.index({ eventId: 1, email: 1 }, { unique: true });
export const NotifyEntry = model('NotifyEntry', notifySchema, 'notifyList');

const newsletterSchema = new Schema({
  email: { type: String, required: true, lowercase: true },
  consentAt: { type: Date, required: true },
  unsubscribedAt: { type: Date, default: null },
  unsubscribeTokenHash: String,
}, { timestamps: true });
newsletterSchema.index({ email: 1 }, { unique: true });
export const Newsletter = model('Newsletter', newsletterSchema, 'newsletter');

const payoutSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  code: { type: String, required: true },
  kind: { type: String, enum: ['regular', 'reserve release'], default: 'regular' },
  amountCents: { type: Number, required: true },
  grossCents: Number, feesCents: Number, refundsCents: Number, reserveCents: Number,
  scheduledFor: { type: Date, required: true },
  status: { type: String, enum: PAYOUT_STATUS, default: 'awaiting approval' },
  bankRef: { type: String, default: null },
  bankAccount: { bank: String, last4: String },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  paidAt: Date,
  /** The bank file the approval produces. Approval never moves money by itself. */
  bankFile: String,
}, { timestamps: true });
payoutSchema.index({ code: 1 }, { unique: true });
payoutSchema.index({ eventId: 1, status: 1 });
export const Payout = model('Payout', payoutSchema);

const invoiceSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  number: { type: String, required: true },
  billTo: { type: String, required: true },
  description: { type: String, required: true },
  amountCents: { type: Number, required: true },
  issuedAt: { type: Date, required: true },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: INVOICE_STATUS, default: 'pending' },
}, { timestamps: true });
invoiceSchema.index({ number: 1 }, { unique: true });
invoiceSchema.index({ eventId: 1, issuedAt: -1 });
export const Invoice = model('Invoice', invoiceSchema);

export type Id = Types.ObjectId;
