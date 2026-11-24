/* venues, events, tiers, presaleCodes, tables, layouts, eventKeys */
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { EVENT_STATUS, GENRES, LAYOUT_OBJECT_TYPES, LAYOUT_STATUS, MODEL_STATUS, REGIONS, SALES_LABEL, TABLE_STATUS, TIER_STATE, VIP_TIERS } from '@void/shared';

const poiSchema = new Schema({ id: String, name: String, dims: String, desc: String, x: Number, z: Number, r: Number, small: Boolean, view: [Number] }, { _id: false });
const venueSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  city: { type: String, required: true },
  capacity: { type: Number, required: true, min: 1 },
  region: { type: String, enum: REGIONS, required: true },
  modelStatus: { type: String, enum: MODEL_STATUS, default: 'none' },
  modelUrl: { type: String, default: null },
  widthM: { type: Number, default: 80 },
  depthM: { type: Number, default: 60 },
  pois: { type: [poiSchema], default: [] },
}, { timestamps: true });
venueSchema.index({ slug: 1 }, { unique: true });
export type VenueDoc = InferSchemaType<typeof venueSchema> & { _id: Types.ObjectId };
export const Venue = model('Venue', venueSchema);

const weekSchema = new Schema({ week: String, tickets: Number, note: String }, { _id: false });
const eventSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true },
  /** The prototype's numeric id (0 to 7), so old links like event.html#e0 still resolve. */
  legacyId: { type: Number, default: null },
  startsAt: { type: Date, required: true },
  gatesAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  venueId: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
  venueName: { type: String, required: true },
  city: { type: String, required: true },
  region: { type: String, enum: REGIONS, required: true },
  genre: { type: String, enum: GENRES, required: true },
  art: { type: String, default: 'festival-stage' },
  fromPriceCents: { type: Number, required: true, min: 0 },
  status: { type: String, enum: EVENT_STATUS, default: 'draft', required: true },
  statusBeforeSuspend: { type: String, enum: [...EVENT_STATUS, null], default: null },
  salesLabel: { type: String, enum: [...SALES_LABEL, null], default: null },
  organizerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  organizerName: { type: String, default: null },
  ageLimit: { type: Number, default: 21 },
  about: { type: String, default: '' },
  playlist: {
    title: { type: String, default: 'The warm-up playlist · 24 tracks' },
    url: { type: String, default: null },
    tracks: { type: [{ title: String, length: String, _id: false }], default: [] },
  },
  capacity: { type: Number, required: true, min: 1 },
  hasVip: { type: Boolean, default: false },
  waitlistOn: { type: Boolean, default: true },
  compsIssued: { type: Number, default: 0 },
  reviewNote: { type: String, default: null },
  approvedAt: Date,
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  /** Running counters, kept in step with paid orders inside the same transaction. Gross is ticket and table face value. */
  stats: { type: new Schema({
    sold: { type: Number, default: 0 },
    orders: { type: Number, default: 0 },
    grossCents: { type: Number, default: 0 },
    ticketGrossCents: { type: Number, default: 0 },
    tableGrossCents: { type: Number, default: 0 },
    feesCents: { type: Number, default: 0 },
    refundsCents: { type: Number, default: 0 },
    refundedOrders: { type: Number, default: 0 },
  }, { _id: false }), required: true, default: () => ({}) },
  /** Sales that happened before this backend existed, imported from the prototype for the charts. */
  baseline: { type: new Schema({
    weekly: { type: [weekSchema], default: [] },
    channels: { type: [{ name: String, tickets: Number, _id: false }], default: [] },
    payments: { type: [{ method: String, amountCents: Number, _id: false }], default: [] },
    preRegistrations: { type: Number, default: 0 },
    kokoOrders: { type: Number, default: 0 },
    onSaleAt: { type: Date, default: null },
  }, { _id: false }), required: true, default: () => ({}) },
  payoutAccount: { bank: String, last4: String },
}, { timestamps: true });
eventSchema.index({ slug: 1 }, { unique: true });
eventSchema.index({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: 'number' } } });
eventSchema.index({ status: 1, startsAt: 1 });
eventSchema.index({ venueId: 1 });
eventSchema.index({ name: 'text', venueName: 'text', city: 'text' }, { name: 'event_text' });
export type EventDoc = InferSchemaType<typeof eventSchema> & { _id: Types.ObjectId };
export const Event = model('Event', eventSchema);

const tierSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  name: { type: String, required: true },
  priceCents: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  sold: { type: Number, default: 0, min: 0 },
  held: { type: Number, default: 0, min: 0 },
  order: { type: Number, required: true },
  window: { startsAt: { type: Date, default: null }, endsAt: { type: Date, default: null } },
  state: { type: String, enum: TIER_STATE, default: 'scheduled' },
  autoAdvance: { type: Boolean, default: true },
}, { timestamps: true });
tierSchema.index({ eventId: 1, order: 1 }, { unique: true });
export type TierDoc = InferSchemaType<typeof tierSchema> & { _id: Types.ObjectId };
export const Tier = model('Tier', tierSchema);

const presaleSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  priceCents: { type: Number, required: true, min: 0 },
  limit: { type: Number, required: true, min: 1 },
  used: { type: Number, default: 0 },
  /** Uses reserved by live holds, so two buyers can't both take the last use. */
  held: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });
presaleSchema.index({ eventId: 1, code: 1 }, { unique: true });
export const PresaleCode = model('PresaleCode', presaleSchema);

const tableSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  code: { type: String, required: true, match: /^[GP]0[1-8]$/ },
  tier: { type: String, enum: VIP_TIERS, required: true },
  seats: { type: Number, required: true },
  minSpendCents: { type: Number, required: true },
  status: { type: String, enum: TABLE_STATUS, default: 'available' },
  holdId: { type: Schema.Types.ObjectId, ref: 'Hold', default: null },
}, { timestamps: true });
tableSchema.index({ eventId: 1, code: 1 }, { unique: true });
export type TableDoc = InferSchemaType<typeof tableSchema> & { _id: Types.ObjectId };
export const Table = model('Table', tableSchema);

const layoutObjectSchema = new Schema({
  type: { type: String, enum: LAYOUT_OBJECT_TYPES, required: true },
  name: { type: String, required: true },
  x: Number, y: Number, w: Number, h: Number,
  capacity: Number, tier: String,
}, { _id: false });
const layoutSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  version: { type: Number, required: true, min: 1 },
  status: { type: String, enum: LAYOUT_STATUS, default: 'draft' },
  /** Only one approved layout per event is live. The fan table map reads it. */
  live: { type: Boolean, default: false },
  objects: { type: [layoutObjectSchema], default: [] },
  widthM: { type: Number, default: 80 },
  depthM: { type: Number, default: 60 },
  floorPlanUrl: { type: String, default: null },
  submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  submittedAt: Date,
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: { type: String, default: null },
}, { timestamps: true });
layoutSchema.index({ eventId: 1, live: 1 }, { unique: true, partialFilterExpression: { live: true } });
layoutSchema.index({ eventId: 1, status: 1 });
export type LayoutDoc = InferSchemaType<typeof layoutSchema> & { _id: Types.ObjectId };
export const Layout = model('Layout', layoutSchema);

/** Ed25519 key pairs for QR tickets, one or more versions per event. The private half is encrypted at rest. */
const eventKeySchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  version: { type: Number, required: true },
  publicKey: { type: String, required: true },
  privateKeyEnc: { type: String, required: true },
  active: { type: Boolean, default: true },
  retiredAt: Date,
}, { timestamps: true });
eventKeySchema.index({ eventId: 1, version: 1 }, { unique: true });
export const EventKey = model('EventKey', eventKeySchema);
