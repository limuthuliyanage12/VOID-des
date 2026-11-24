import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthResult, SessionUser } from '@void/shared';
import { env } from '../../config/env.js';
import { Session, User, type UserDoc } from '../../db/models/index.js';
import { decrypt, encrypt, randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, conflict, notImplemented, unauthorized } from '../../lib/errors.js';
import { assertStrongPassword, hashPassword, verifyPassword } from '../../lib/password.js';
import { audit } from '../../lib/platform.js';
import { signAccess } from '../../lib/tokens.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp.js';

export const REFRESH_COOKIE = 'void_rt';
const GOOGLE_COOKIE = 'void_g';
const cookieBase = () => ({ httpOnly: true, secure: env.isProd, sameSite: 'lax' as const, path: '/api/v1/auth' });

const needsMfa = (u: Pick<UserDoc, 'role'>) => u.role === 'organizer' || u.role === 'super';

export const sessionUser = (u: UserDoc, mfa: boolean): SessionUser => ({
  id: String(u._id), name: u.name, email: u.email, role: u.role, assignedEventId: u.assignedEventId ? String(u.assignedEventId) : null, mfa,
});

const issue = async (u: UserDoc, mfa: boolean, res: Response, familyId = randomToken(12)): Promise<AuthResult> => {
  const refresh = randomToken(32);
  await Session.create({ userId: u._id, tokenHash: sha256(refresh), familyId, mfa, expiresAt: new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000) });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), maxAge: env.refreshTokenTtlDays * 86_400_000 });
  const accessToken = await signAccess({ sub: String(u._id), role: u.role, eid: u.assignedEventId ? String(u.assignedEventId) : null, mfa, name: u.name, email: u.email });
  return { accessToken, expiresIn: env.accessTokenTtlSec, user: sessionUser(u, mfa), ...(needsMfa(u) && !u.totp?.enabled ? { mfaSetupRequired: true } : {}) };
};

export const signup = async (b: { name: string; email: string; password: string; phone?: string; marketingConsent: boolean }, res: Response) => {
  await assertStrongPassword(b.password);
  if (await User.exists({ email: b.email })) throw conflict('An account with that email already exists. Sign in instead.', undefined, 'EMAIL_TAKEN');
  const u = await User.create({ name: b.name, email: b.email, phone: b.phone, passwordHash: await hashPassword(b.password), role: 'fan', marketingConsent: { given: b.marketingConsent, at: b.marketingConsent ? new Date() : null } });
  return issue(u.toObject() as UserDoc, false, res);
};

export const login = async (b: { email: string; password: string; otp?: string }, res: Response) => {
  const u = await User.findOne({ email: b.email }).lean<UserDoc>();
  const ok = u && u.status === 'active' && (await verifyPassword(u.passwordHash, b.password));
  if (!ok) throw new AppError(401, 'BAD_CREDENTIALS', 'That email and password don’t match');
  let mfa = false;
  if (needsMfa(u) && u.totp?.enabled && u.totp.secretEnc) {
    if (!b.otp) throw new AppError(401, 'MFA_CODE_REQUIRED', 'Enter the 6-digit code from your authenticator app');
    if (!verifyTotp(decrypt(u.totp.secretEnc), b.otp)) throw new AppError(401, 'MFA_CODE_WRONG', 'That code is not right. Try the newest one.');
    mfa = true;
  }
  await User.updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() } });
  return issue(u, mfa, res);
};

export const refresh = async (token: string | undefined, res: Response) => {
  if (!token) throw unauthorized('Sign in to continue');
  const s = await Session.findOne({ tokenHash: sha256(token) });
  if (!s || s.expiresAt < new Date()) throw unauthorized('Your session has ended. Sign in again.');
  if (s.revokedAt) {
    /* A refresh token used twice means it leaked. End the whole family. */
    await Session.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.clearCookie(REFRESH_COOKIE, cookieBase());
    throw new AppError(401, 'SESSION_REUSED', 'For your safety we signed you out. Sign in again.');
  }
  const u = await User.findById(s.userId).lean<UserDoc>();
  if (!u || u.status !== 'active') throw unauthorized('This account is no longer active');
  const claimed = await Session.findOneAndUpdate({ _id: s._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!claimed) throw new AppError(401, 'SESSION_REUSED', 'Sign in again.');
  return issue(u, s.mfa, res, s.familyId);
};

export const logout = async (token: string | undefined, res: Response) => {
  if (token) {
    const s = await Session.findOne({ tokenHash: sha256(token) });
    if (s) await Session.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
  res.clearCookie(REFRESH_COOKIE, cookieBase());
};

/* ---------- TOTP for organizer and super admin ---------- */
export const totpSetup = async (userId: string) => {
  const u = await User.findById(userId);
  if (!u) throw unauthorized();
  if (u.totp?.enabled) throw conflict('Two-step sign-in is already on for this account');
  const secret = newTotpSecret();
  u.set('totp', { secretEnc: encrypt(secret), enabled: false });
  await u.save();
  return { secret, otpauthUrl: otpauthUrl(secret, u.email) };
};

export const totpVerify = async (userId: string, otp: string, res: Response) => {
  const u = await User.findById(userId);
  if (!u?.totp?.secretEnc) throw conflict('Start two-step setup first');
  if (!verifyTotp(decrypt(u.totp.secretEnc), otp)) throw new AppError(401, 'MFA_CODE_WRONG', 'That code is not right. Try the newest one.');
  u.set('totp.enabled', true); u.set('totp.enabledAt', new Date());
  await u.save();
  await audit({ id: u._id, label: u.name }, 'Turned on two-step sign-in', u.email);
  return issue(u.toObject() as UserDoc, true, res);
};

/* ---------- Invites (organizer admins and gate staff) ---------- */
export const acceptInvite = async (token: string, password: string, res: Response) => {
  await assertStrongPassword(password);
  const u = await User.findOne({ 'invite.tokenHash': sha256(token), 'invite.expiresAt': { $gt: new Date() }, status: 'invited' });
  if (!u) throw new AppError(410, 'INVITE_INVALID', 'This invite link has expired or was already used');
  u.passwordHash = await hashPassword(password);
  u.status = 'active';
  u.set('invite', undefined);
  await u.save();
  await audit({ id: u._id, label: u.name }, 'Accepted invite', u.email);
  return issue(u.toObject() as UserDoc, false, res);
};

/* ---------- Google sign-in with PKCE ---------- */
const googleOn = () => !!env.google.clientId && !!env.google.clientSecret && !!env.google.redirectUri;
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const googleStart = (res: Response) => {
  if (!googleOn()) throw notImplemented('Google sign-in is not set up on this server');
  const state = randomToken(16), verifier = randomToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  res.cookie(GOOGLE_COOKIE, encrypt(JSON.stringify({ state, verifier, exp: Date.now() + 600_000 })), { ...cookieBase(), maxAge: 600_000 });
  const q = new URLSearchParams({ client_id: env.google.clientId, redirect_uri: env.google.redirectUri, response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
};

export const googleFinish = async (b: { code: string; state: string }, cookie: string | undefined, res: Response) => {
  if (!googleOn()) throw notImplemented('Google sign-in is not set up on this server');
  let saved: { state: string; verifier: string; exp: number };
  try { saved = JSON.parse(decrypt(cookie ?? '')); } catch { throw unauthorized('Start Google sign-in again'); }
  if (saved.exp < Date.now() || saved.state !== b.state) throw unauthorized('Start Google sign-in again');
  res.clearCookie(GOOGLE_COOKIE, cookieBase());
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ code: b.code, client_id: env.google.clientId, client_secret: env.google.clientSecret, redirect_uri: env.google.redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier }),
  });
  const tok = (await tokenRes.json()) as { id_token?: string };
  if (!tok.id_token) throw unauthorized('Google did not sign you in');
  const { payload } = await jwtVerify(tok.id_token, jwks, { audience: env.google.clientId, issuer: ['https://accounts.google.com', 'accounts.google.com'] });
  if (!payload.email || payload.email_verified !== true) throw unauthorized('Use a Google account with a verified email');
  const email = String(payload.email).toLowerCase();
  let u = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });
  if (u && u.status !== 'active') throw unauthorized('This account is not active');
  if (u && !u.googleId) { u.googleId = payload.sub!; await u.save(); }
  if (!u) u = await User.create({ name: String(payload.name ?? email.split('@')[0]), email, googleId: payload.sub, role: 'fan' });
  if (needsMfa(u)) throw new AppError(403, 'USE_PASSWORD', 'Staff accounts sign in with email, password and an authenticator code');
  return issue(u.toObject() as UserDoc, false, res);
};
