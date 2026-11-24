/* holds, orders, payments, splitGroups, splitShares, kokoPlans */
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { HOLD_KIND, HOLD_STATUS, KOKO_STATUS, ORDER_STATUS, PAY_METHOD, PAYMENT_STATUS, PROVIDERS, SHARE_STATUS, SPLIT_STATUS } from '@void/shared';

const holdSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  guestEmail: { type: String, default: null },
  kind: { type: String, enum: HOLD_KIND, required: true },
  tierId: { type: Schema.Types.ObjectId, ref: 'Tier', default: null },
  tableId: { type: Schema.Types.ObjectId, ref: 'Table', default: null },
  tableCode: { type: String, default: null },
  qty: { type: Number, required: true, min: 1 },
  unitCents: { type: Number, required: true },
  label: { type: String, required: true },
  presaleCodeId: { type: Schema.Types.ObjectId, ref: 'PresaleCode', default: null },
  /** The buyer gets the secret once. Only its hash is kept, so a hold id alone can't be checked out. */
  secretHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: HOLD_STATUS, default: 'active' },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  releasedReason: String,
}, { timestamps: true });
/* Backstop only. The expireHold job gives the seats back; this deletes the leftovers a day later. */
holdSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });
holdSchema.index({ status: 1, expiresAt: 1 });
holdSchema.index({ tierId: 1, status: 1 });
export type HoldDoc = InferSchemaType<typeof holdSchema> & { _id: Types.ObjectId };
export const Hold = model('Hold', holdSchema);

const lineSchema = new Schema({
  kind: { type: String, enum: ['tier', 'table', 'presale', 'comp', 'box office'], required: true },
  tierId: { type: Schema.Types.ObjectId, ref: 'Tier', default: null },
  tableId: { type: Schema.Types.ObjectId, ref: 'Table', default: null },
  tableCode: { type: String, default: null },
  presaleCodeId: { type: Schema.Types.ObjectId, ref: 'PresaleCode', default: null },
  label: String,
  qty: { type: Number, required: true },
  unitCents: { type: Number, required: true },
  seats: Number,
}, { _id: false });

const orderSchema = new Schema({
  code: { type: String, required: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  buyer: { type: new Schema({ name: { type: String, required: true }, email: { type: String, required: true, lowercase: true }, mobile: String }, { _id: false }), required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  lines: { type: [lineSchema], required: true },
  line: { type: String, required: true },
  qty: { type: Number, required: true },
  admits: { type: Number, required: true },
  subtotalCents: { type: Number, required: true },
  feePercent: { type: Number, required: true },
  feeCents: { type: Number, required: true },
  totalCents: { type: Number, required: true },
  refundedCents: { type: Number, default: 0 },
  payMethod: { type: String, enum: PAY_METHOD, required: true },
  status: { type: String, enum: ORDER_STATUS, default: 'pending' },
  source: { type: String, default: null },
  holdId: { type: Schema.Types.ObjectId, ref: 'Hold', default: null },
  splitGroupId: { type: Schema.Types.ObjectId, ref: 'SplitGroup', default: null },
  /** Lets a guest open their confirmation and tickets from the email link. Hashed at rest. */
  viewTokenHash: { type: String, default: null },
  marketingConsent: { type: Boolean, default: false },
  paidAt: Date,
  cancelledAt: Date,
  /** Set once the sold counters have moved, so a repeated job can't count a sale twice. */
  counted: { type: Boolean, default: false },
  ticketsIssuedAt: Date,
  /** Set when the ticket email went out, so a retried job doesn't send it twice. */
  notifiedAt: Date,
  anonymisedAt: Date,
}, { timestamps: true });
orderSchema.index({ code: 1 }, { unique: true });
orderSchema.index({ eventId: 1, status: 1 });
orderSchema.index({ 'buyer.email': 1 });
orderSchema.index({ userId: 1 });
export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const Order = model('Order', orderSchema);

const paymentSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  splitShareId: { type: Schema.Types.ObjectId, ref: 'SplitShare', default: null },
  provider: { type: String, enum: PROVIDERS, required: true },
  providerPaymentId: { type: String, required: true },
  /** The order_id we sent the provider: the order code, or code-S1 for a split share. */
  providerOrderId: { type: String, required: true },
  amountCents: { type: Number, required: true },
  currency: { type: String, default: 'LKR' },
  status: { type: String, enum: PAYMENT_STATUS, required: true },
  method: { type: String, default: null },
  /** The signed callback body exactly as it arrived. */
  raw: { type: Schema.Types.Mixed },
  history: { type: [{ status: String, at: Date, raw: Schema.Types.Mixed, _id: false }], default: [] },
  verifiedAt: Date,
  processedAt: Date,
  refundedAt: Date,
  refundRef: String,
  refundAmountCents: { type: Number, default: 0 },
  needsAttention: { type: String, default: null },
}, { timestamps: true });
paymentSchema.index({ provider: 1, providerPaymentId: 1 }, { unique: true });
paymentSchema.index({ orderId: 1 });
export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: Types.ObjectId };
export const Payment = model('Payment', paymentSchema);

const splitGroupSchema = new Schema({
  code: { type: String, required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  leadUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  leadName: { type: String, required: true },
  size: { type: Number, required: true, min: 2, max: 6 },
  shareCents: { type: Number, required: true },
  leadShareCents: { type: Number, required: true },
  /** Null until the lead pays. Then 48 hours from that moment, plus any extension. */
  expiresAt: { type: Date, default: null },
  status: { type: String, enum: SPLIT_STATUS, default: 'open' },
  extendedBy: { type: Number, default: 0 },
  remindersSent: { type: [Number], default: [] },
  releasedReason: String,
}, { timestamps: true });
splitGroupSchema.index({ code: 1 }, { unique: true });
splitGroupSchema.index({ status: 1, expiresAt: 1 });
splitGroupSchema.index({ orderId: 1 }, { unique: true });
export type SplitGroupDoc = InferSchemaType<typeof splitGroupSchema> & { _id: Types.ObjectId };
export const SplitGroup = model('SplitGroup', splitGroupSchema);

const splitShareSchema = new Schema({
  groupId: { type: Schema.Types.ObjectId, ref: 'SplitGroup', required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  index: { type: Number, required: true },
  name: { type: String, default: null },
  email: { type: String, default: null },
  /** Random, single use, hashed at rest. The lead's own share (index 0) has none. */
  tokenHash: { type: String, default: null },
  amountCents: { type: Number, required: true },
  status: { type: String, enum: SHARE_STATUS, default: 'waiting' },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
  paidAt: Date,
}, { timestamps: true });
splitShareSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } });
splitShareSchema.index({ groupId: 1, index: 1 }, { unique: true });
export type SplitShareDoc = InferSchemaType<typeof splitShareSchema> & { _id: Types.ObjectId };
export const SplitShare = model('SplitShare', splitShareSchema);

const kokoPlanSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  kokoRef: { type: String, required: true },
  amountCents: { type: Number, required: true },
  instalments: { type: Number, default: 3 },
  received: { type: Number, default: 0 },
  status: { type: String, enum: KOKO_STATUS, default: 'pending approval' },
  lastSyncedAt: Date,
}, { timestamps: true });
kokoPlanSchema.index({ orderId: 1 }, { unique: true });
kokoPlanSchema.index({ kokoRef: 1 }, { unique: true });
export const KokoPlan = model('KokoPlan', kokoPlanSchema);
