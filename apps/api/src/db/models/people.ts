/* users, sessions (refresh tokens) */
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ROLES } from '@void/shared';

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String },
  passwordHash: { type: String },
  googleId: { type: String },
  role: { type: String, enum: ROLES, default: 'fan', required: true },
  /** Organizers and gate staff only. One event each. */
  assignedEventId: { type: Schema.Types.ObjectId, ref: 'Event', default: null },
  marketingConsent: { given: { type: Boolean, default: false }, at: { type: Date, default: null } },
  status: { type: String, enum: ['active', 'invited', 'suspended', 'deleted'], default: 'active' },
  totp: { secretEnc: String, enabled: { type: Boolean, default: false }, enabledAt: Date },
  invite: { tokenHash: String, expiresAt: Date },
  notifications: { orders: { type: Boolean, default: true }, splitReminders: { type: Boolean, default: true }, dailyDigest: { type: Boolean, default: true } },
  lastLoginAt: Date,
  joinedAt: { type: Date, default: () => new Date() },
}, { timestamps: true });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });
userSchema.index({ role: 1, assignedEventId: 1 });
userSchema.pre('validate', function (next) {
  if (this.role === 'organizer' && !this.assignedEventId) return next(new Error('An organizer needs exactly one assigned event'));
  if (this.role === 'fan' || this.role === 'super') this.assignedEventId = null;
  next();
});
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = model('User', userSchema);

const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  familyId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  replacedByHash: String,
  mfa: { type: Boolean, default: false },
}, { timestamps: true });
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ familyId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = model('Session', sessionSchema);
