/* tickets, transfers, refundRequests, scans, gateStaff */
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { GATE_ROLES, REFUND_STATUS, SCAN_RESULT, TICKET_KIND, TICKET_STATUS, TRANSFER_STATUS } from '@void/shared';

const ticketSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  orderCode: { type: String, required: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  holderName: { type: String, required: true },
  holderEmail: { type: String, required: true, lowercase: true },
  holderUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  kind: { type: String, enum: TICKET_KIND, required: true },
  /** A party pass admits the whole party on one QR. */
  admits: { type: Number, required: true, min: 1 },
  line: { type: String, required: true },
  /** Bumped on transfer, so the old holder's QR stops working. */
  qrSecretVersion: { type: Number, default: 1 },
  keyVersion: { type: Number, default: 1 },
  status: { type: String, enum: TICKET_STATUS, default: 'valid' },
  usedAt: Date,
  gate: String,
  voidReason: String,
}, { timestamps: true });
ticketSchema.index({ orderId: 1 });
ticketSchema.index({ holderEmail: 1 });
ticketSchema.index({ holderUserId: 1 });
ticketSchema.index({ eventId: 1, status: 1 });
export type TicketDoc = InferSchemaType<typeof ticketSchema> & { _id: Types.ObjectId };
export const Ticket = model('Ticket', ticketSchema);

const transferSchema = new Schema({
  ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  fromEmail: String,
  toName: { type: String, required: true },
  toEmail: { type: String, required: true, lowercase: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: TRANSFER_STATUS, default: 'sent' },
  acceptedAt: Date,
}, { timestamps: true });
transferSchema.index({ tokenHash: 1 }, { unique: true });
transferSchema.index({ ticketId: 1, status: 1 });
export const Transfer = model('Transfer', transferSchema);

const refundRequestSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  requesterEmail: String,
  reason: { type: String, required: true },
  ticketIds: { type: [Schema.Types.ObjectId], default: [] },
  status: { type: String, enum: REFUND_STATUS, default: 'requested' },
  amountCents: { type: Number, default: 0 },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  note: String,
}, { timestamps: true });
refundRequestSchema.index({ eventId: 1, status: 1 });
refundRequestSchema.index({ orderId: 1 });
export const RefundRequest = model('RefundRequest', refundRequestSchema);

const scanSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', default: null },
  staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  gate: String,
  result: { type: String, enum: SCAN_RESULT, required: true },
  admits: { type: Number, default: 0 },
  scannedAt: { type: Date, required: true },
  /** Set when the scan came in through offline sync. */
  syncedAt: { type: Date, default: null },
  /** Two devices admitted the same ticket offline. The later one is flagged for the gate lead. */
  flagged: { type: Boolean, default: false },
  note: String,
}, { timestamps: true });
/* A second admit of the same ticket fails here, whatever the race. */
scanSchema.index({ ticketId: 1 }, { unique: true, partialFilterExpression: { result: 'admitted' } });
scanSchema.index({ eventId: 1, result: 1, scannedAt: -1 });
export const Scan = model('Scan', scanSchema);

const gateStaffSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  mobile: String,
  role: { type: String, enum: GATE_ROLES, default: 'scanner' },
  gateAccess: { type: Boolean, default: true },
  boxOffice: { type: Boolean, default: false },
  lastSeenAt: Date,
}, { timestamps: true });
gateStaffSchema.index({ eventId: 1, userId: 1 }, { unique: true });
export const GateStaff = model('GateStaff', gateStaffSchema);
