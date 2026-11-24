/*
 * The scope guard. Every route under /admin/events/{eventId} passes through here.
 * An organizer (or gate staff) may only touch the event in their token's assignedEventId; the super admin may touch any.
 * Services then filter every query by req.scope.eventId as well, so a missed check still can't leak another event.
 */
import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Event, GateStaff } from '../db/models/index.js';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';

export const resolveEvent = async (ref: string) => {
  const q = Types.ObjectId.isValid(ref) && /^[a-f\d]{24}$/i.test(ref) ? { _id: ref } : /^\d{1,3}$/.test(ref) ? { legacyId: Number(ref) } : { slug: ref.toLowerCase() };
  return Event.findOne(q);
};

export const eventScope = (allow: ('organizer' | 'gate' | 'super')[] = ['organizer', 'super']): RequestHandler => async (req, _res, next) => {
  const a = req.auth;
  if (!a) throw unauthorized();
  if (!allow.includes(a.role as never)) throw forbidden();
  if (env.requireMfa && (a.role === 'organizer' || a.role === 'super') && !a.mfa) throw new AppError(403, 'MFA_REQUIRED', 'Set up and use your authenticator code to open this workspace.');
  const ref = String(req.params.eventId ?? '');
  /* Check the claim before touching the database, so a wrong id answers the same whether or not it exists. */
  if (a.role !== 'super' && (!a.eid || (ref !== a.eid && !(await sameEvent(ref, a.eid))))) throw forbidden('You can only work on the event assigned to you');
  const event = await resolveEvent(ref);
  if (!event) throw notFound('Event');
  if (a.role !== 'super' && String(event._id) !== a.eid) throw forbidden('You can only work on the event assigned to you');
  req.scope = { eventId: String(event._id), event: event.toObject() as never };
  next();
};

const sameEvent = async (ref: string, eid: string) => {
  if (/^[a-f\d]{24}$/i.test(ref)) return false;
  const e = await resolveEvent(ref);
  return !!e && String(e._id) === eid;
};

/** Gate staff need their toggle on. Organizers and the super admin always pass. */
export const gatePermission = (kind: 'gateAccess' | 'boxOffice'): RequestHandler => async (req, _res, next) => {
  if (!req.auth || !req.scope) throw unauthorized();
  if (req.auth.role !== 'gate') return next();
  const s = await GateStaff.findOne({ eventId: req.scope.eventId, userId: req.auth.sub }).lean();
  if (!s || !s[kind]) throw forbidden(kind === 'gateAccess' ? 'Gate access is off for your account. Ask the gate lead.' : 'Box office is off for your account. Ask the gate lead.');
  next();
};
