import type { AccessClaims } from '../lib/tokens.js';
import type { EventDoc } from '../db/models/index.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AccessClaims;
      authError?: 'expired' | 'invalid';
      scope?: { eventId: string; event: EventDoc };
      rawBody?: string;
    }
  }
}
export {};
