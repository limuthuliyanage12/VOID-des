/*
 * Access tokens arrive as "Authorization: Bearer". Role and assignedEventId travel in the token
 * and are re-checked against the database on every write, so a removed organizer can't keep acting on an old token.
 */
import type { RequestHandler } from 'express';
import { errors as joseErrors } from 'jose';
import type { Role } from '@void/shared';
import { env } from '../config/env.js';
import { User } from '../db/models/index.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccess } from '../lib/tokens.js';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Reads the token if there is one. Never rejects by itself. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try { req.auth = await verifyAccess(h.slice(7)); }
    catch (e) { req.authError = e instanceof joseErrors.JWTExpired ? 'expired' : 'invalid'; }
  }
  next();
};

const recheck = async (req: Parameters<RequestHandler>[0]) => {
  if (!req.auth || !WRITE.has(req.method)) return;
  const u = await User.findById(req.auth.sub, { role: 1, assignedEventId: 1, status: 1 }).lean();
  if (!u || u.status === 'suspended' || u.status === 'deleted') throw unauthorized('This account is no longer active');
  if (u.role !== req.auth.role || String(u.assignedEventId ?? '') !== String(req.auth.eid ?? '')) {
    throw new AppError(401, 'SESSION_STALE', 'Your access has changed. Sign in again.');
  }
};

export const requireAuth: RequestHandler = async (req, _res, next) => {
  if (!req.auth) {
    if (req.authError === 'expired') throw new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Refresh and try again.');
    throw unauthorized();
  }
  await recheck(req);
  next();
};

/** For routes a guest can also use: re-checks a signed-in user on writes, lets guests through. */
export const softAuth: RequestHandler = async (req, _res, next) => {
  if (req.authError === 'expired') throw new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Refresh and try again.');
  await recheck(req);
  next();
};

export const requireRole = (...roles: Role[]): RequestHandler => async (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  if (!roles.includes(req.auth.role)) throw forbidden();
  /* Organizer and super admin accounts need a second factor. */
  if (env.requireMfa && (req.auth.role === 'organizer' || req.auth.role === 'super') && !req.auth.mfa) {
    throw new AppError(403, 'MFA_REQUIRED', 'Set up and use your authenticator code to open this workspace.');
  }
  next();
};

export const isStaff = (role?: Role) => role === 'organizer' || role === 'gate' || role === 'super';
