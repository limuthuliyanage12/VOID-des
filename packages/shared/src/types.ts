/* Response shapes both sides import. Money fields end in Cents. Dates are ISO strings in UTC. */
import type { EventStatus, OrderStatus, PayMethod, Role, ScanResult, TierState, VipTier } from './constants.js';

export interface ApiError { code: string; message: string; details?: unknown }
export interface Page<T> { items: T[]; total: number; page: number; limit: number }

export interface SessionUser { id: string; name: string; email: string; role: Role; assignedEventId: string | null; mfa: boolean }
export interface AuthResult { accessToken: string; expiresIn: number; user: SessionUser; mfaSetupRequired?: boolean }

export interface EventCard {
  id: string; slug: string; legacyId: number | null; name: string;
  startsAt: string; gatesAt: string; endsAt: string; date: string;
  venue: string; city: string; region: string; genre: string; art: string;
  fromPriceCents: number; status: EventStatus; label: string; organizer: string | null;
  capacity: number; hasModel: boolean; hasVip: boolean;
}

export interface TierView {
  id: string; name: string; priceCents: number; total: number; left: number; order: number;
  state: TierState; startsAt: string | null; endsAt: string | null;
}

export interface EventDetail extends EventCard {
  about: string; ageLimit: number; playlist: { title: string; tracks: { title: string; length: string }[]; url: string | null };
  tiers: TierView[]; liveTierId: string | null;
  vip: Record<VipTier, { name: string; minSpendCents: number; seats: number; free: number; total: number; perks: readonly string[] }> | null;
  closed: null | { kind: string; action: string };
  bookingFeePercent: number;
}

export interface TableView { code: string; tier: VipTier; seats: number; minSpendCents: number; status: 'available' | 'held' | 'reserved' }

export interface HoldView { id: string; secret?: string; kind: 'tier' | 'table'; qty: number; unitCents: number; label: string; expiresAt: string; displayExpiresAt: string }

export interface PayHereForm { provider: 'payhere'; action: string; method: 'POST'; fields: Record<string, string> }
export interface KokoRedirect { provider: 'koko'; redirectUrl: string }

export interface OrderView {
  code: string; status: OrderStatus; payMethod: PayMethod; event: { id: string; name: string; startsAt: string; venue: string; city: string };
  buyer: { name: string; email: string }; line: string; qty: number; admits: number;
  subtotalCents: number; feePercent: number; feeCents: number; totalCents: number;
  split: null | { code: string; size: number; shareCents: number; leadShareCents: number; expiresAt: string | null; status: string; shares: { index: number; name: string; status: string; amountCents: number }[] };
  tickets: TicketView[];
}

export interface TicketView {
  id: string; orderCode: string; kind: 'ga' | 'table' | 'party'; admits: number; status: string; holderName: string;
  line: string; event: { id: string; name: string; startsAt: string; gatesAt: string; venue: string; city: string; art: string };
  qr: string | null;
}

export interface ScanView { result: ScanResult; holderName?: string; line?: string; admits?: number; at: string; message: string }
