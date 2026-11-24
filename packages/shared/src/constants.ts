/* Status words, roles and rule numbers that both the API and the frontend use. */

export const ROLES = ['fan', 'organizer', 'gate', 'super'] as const;
export type Role = (typeof ROLES)[number];

export const EVENT_STATUS = ['draft', 'in review', 'live', 'sold out', 'suspended', 'rejected', 'registering'] as const;
export type EventStatus = (typeof EVENT_STATUS)[number];
/** Statuses a fan can see on the public site. */
export const PUBLIC_EVENT_STATUS: EventStatus[] = ['live', 'sold out', 'suspended', 'registering'];
/** Statuses the super admin treats as "waiting for a decision". */
export const REVIEW_EVENT_STATUS: EventStatus[] = ['in review', 'registering'];

export const SALES_LABEL = ['Selling fast', 'On sale'] as const;

export const TIER_STATE = ['scheduled', 'on sale', 'sold out', 'up next'] as const;
export type TierState = (typeof TIER_STATE)[number];

export const VIP_TIERS = ['gold', 'platinum'] as const;
export type VipTier = (typeof VIP_TIERS)[number];
export const TABLE_STATUS = ['available', 'held', 'reserved'] as const;

export const LAYOUT_STATUS = ['draft', 'awaiting review', 'approved', 'changes requested'] as const;
export const LAYOUT_OBJECT_TYPES = ['stage', 'zone', 'table', 'seats', 'stall', 'bar', 'restroom', 'gate', 'barrier', 'tree', 'dj', 'rig'] as const;

export const HOLD_KIND = ['tier', 'table'] as const;
export const HOLD_STATUS = ['active', 'converted', 'expired', 'released'] as const;

export const ORDER_STATUS = ['pending', 'paid', 'split pending', 'refunded', 'partially refunded', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];
export const PAY_METHOD = ['card', 'koko', 'split', 'cash', 'comp'] as const;
export type PayMethod = (typeof PAY_METHOD)[number];

export const PAYMENT_STATUS = ['pending', 'success', 'cancelled', 'failed', 'charged back', 'refunded'] as const;
export const PROVIDERS = ['payhere', 'koko', 'box office', 'comp'] as const;

export const SPLIT_STATUS = ['open', 'complete', 'released'] as const;
export const SHARE_STATUS = ['waiting', 'paid', 'refunded'] as const;
export const KOKO_STATUS = ['pending approval', 'active', 'completed', 'failed'] as const;

export const TICKET_KIND = ['ga', 'table', 'party'] as const;
export const TICKET_STATUS = ['valid', 'used', 'void', 'transferred'] as const;
export const TRANSFER_STATUS = ['sent', 'accepted', 'cancelled'] as const;
export const REFUND_STATUS = ['requested', 'approved', 'rejected', 'paid'] as const;
export const SCAN_RESULT = ['admitted', 'duplicate', 'invalid', 'wrong event'] as const;
export type ScanResult = (typeof SCAN_RESULT)[number];
export const GATE_ROLES = ['scanner', 'box office', 'gate lead'] as const;

export const PAYOUT_STATUS = ['awaiting approval', 'approved', 'paid'] as const;
export const INVOICE_STATUS = ['draft', 'pending', 'paid'] as const;
export const NOTIFY_KIND = ['notify', 'waitlist', 'resume'] as const;
export const MESSAGE_CHANNEL = ['sms', 'email'] as const;
export const REGIONS = ['Colombo', 'South coast', 'Hill country'] as const;
export const MODEL_STATUS = ['none', 'in review', 'ready'] as const;
export const GENRES = ['Electronic', 'Live music', 'Jazz'] as const;

/* Rule numbers from the prototype. The settings document can change the first five. */
export const RULES = {
  bookingFeePercent: 5,
  splitHoldHours: 48,
  seatHoldMinutes: 10,
  kokoInstalments: 3,
  refundReservePercent: 1.2,
  maxGaQty: 10,
  minGroup: 2,
  maxGroup: 6,
  compLimit: 50,
  smsCostCents: 250,
  smsMaxChars: 160,
  splitExtendHours: 48,
  splitWarnHours: 6,
  partyPassOver: 3,
  reserveReleaseDays: 30,
  /** What the fan screen shows for a hold. The server holds for the full 10 minutes. */
  holdDisplayMs: (9 * 60 + 41) * 1000,
} as const;

export const VIP = {
  gold: { name: 'Gold', prefix: 'G', seats: 6, minSpendCents: 10_000_000, perks: ['Raised deck with a clear stage view', 'VIP entrance', 'Seats up to 6'] },
  platinum: { name: 'Platinum', prefix: 'P', seats: 10, minSpendCents: 18_000_000, perks: ['Lake-side deck beside the stage', 'VIP entrance and table host', 'Seats up to 10'] },
} as const;

/** How the fan site words an event's status. */
export const eventLabel = (e: { status: EventStatus; salesLabel?: string | null }): string => {
  switch (e.status) {
    case 'live': return e.salesLabel || 'On sale';
    case 'sold out': return 'Sold out';
    case 'suspended': return 'Sales paused';
    case 'registering': return 'Registering interest';
    case 'in review': return 'In review';
    case 'draft': return 'Draft';
    case 'rejected': return 'Rejected';
  }
};

/** Why the event page shows the closed note instead of tickets, or null when it is bookable. */
export const closedReason = (status: EventStatus): null | { kind: 'paused' | 'sold out' | 'registering' | 'unavailable'; action: string } => {
  if (status === 'live') return null;
  if (status === 'suspended') return { kind: 'paused', action: 'Tell Me When Sales Resume' };
  if (status === 'sold out') return { kind: 'sold out', action: 'Join Waitlist' };
  if (status === 'registering') return { kind: 'registering', action: 'Notify Me' };
  return { kind: 'unavailable', action: '' };
};

export const tableCode = (tier: VipTier, n: number): string => VIP[tier].prefix + String(n).padStart(2, '0');
export const TABLE_CODE_RE = /^[GP]0[1-8]$/;
