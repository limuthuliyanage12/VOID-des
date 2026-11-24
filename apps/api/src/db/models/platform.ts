/* settings, auditLog, counters, idempotencyKeys, privacyRequests, breaches */
import { Schema, model, type InferSchemaType } from 'mongoose';
import { RULES } from '@void/shared';

const settingsSchema = new Schema({
  key: { type: String, default: 'platform' },
  bookingFeePercent: { type: Number, default: RULES.bookingFeePercent, min: 0, max: 15 },
  splitHoldHours: { type: Number, default: RULES.splitHoldHours },
  seatHoldMinutes: { type: Number, default: RULES.seatHoldMinutes },
  kokoInstalments: { type: Number, default: RULES.kokoInstalments },
  refundReservePercent: { type: Number, default: RULES.refundReservePercent },
  platformName: { type: String, default: 'VOID' },
  supportEmail: { type: String, default: 'hello@eventsbythevoid.lk' },
  currency: { type: String, default: 'LKR', immutable: true },
  timeZone: { type: String, default: 'Asia/Colombo', immutable: true },
  dataProtectionContact: { type: String, default: 'Data protection officer, privacy@eventsbythevoid.lk' },
  /** Days after the event, run by the nightly scrub job. */
  retention: { type: new Schema({
    notifyListDays: { type: Number, default: 30 },
    guestContactDays: { type: Number, default: 365 },
    scanDeviceDays: { type: Number, default: 90 },
    unsubscribedDays: { type: Number, default: 30 },
  }, { _id: false }), required: true, default: () => ({}) },
}, { timestamps: true });
settingsSchema.index({ key: 1 }, { unique: true });
export type SettingsDoc = InferSchemaType<typeof settingsSchema>;
export const Settings = model('Settings', settingsSchema, 'settings');

const auditSchema = new Schema({
  at: { type: Date, default: () => new Date(), required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorLabel: { type: String, required: true },
  action: { type: String, required: true },
  target: { type: String, required: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', default: null },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, default: null },
  result: { type: String, default: 'Done' },
}, { timestamps: false, versionKey: false });
auditSchema.index({ at: -1 });
auditSchema.index({ eventId: 1, at: -1 });
/* Append only. */
const refuse = function (next: (e?: Error) => void) { next(new Error('The audit log is append only')); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace'] as const) {
  auditSchema.pre(op, refuse as never);
}
export const AuditLog = model('AuditLog', auditSchema, 'auditLog');

const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number } }, { versionKey: false });
export const Counter = model('Counter', counterSchema);

const idemSchema = new Schema({
  key: { type: String, required: true },
  scope: { type: String, required: true },
  route: { type: String, required: true },
  state: { type: String, enum: ['pending', 'done'], default: 'pending' },
  statusCode: Number,
  body: Schema.Types.Mixed,
  createdAt: { type: Date, default: () => new Date() },
}, { versionKey: false });
idemSchema.index({ key: 1, scope: 1, route: 1 }, { unique: true });
idemSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86_400 });
export const IdempotencyKey = model('IdempotencyKey', idemSchema);

const privacyRequestSchema = new Schema({
  kind: { type: String, enum: ['access', 'export', 'delete', 'correct'], required: true },
  email: { type: String, required: true, lowercase: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  details: String,
  status: { type: String, enum: ['open', 'in progress', 'done', 'rejected'], default: 'open' },
  note: String,
  handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  dueAt: { type: Date, required: true },
  closedAt: Date,
}, { timestamps: true });
privacyRequestSchema.index({ status: 1, dueAt: 1 });
export const PrivacyRequest = model('PrivacyRequest', privacyRequestSchema);

const breachSchema = new Schema({
  summary: { type: String, required: true },
  detectedAt: { type: Date, required: true },
  affected: { type: Number, default: 0 },
  reportedToAuthorityAt: { type: Date, default: null },
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['open', 'contained', 'closed'], default: 'open' },
}, { timestamps: true });
export const Breach = model('Breach', breachSchema);
