/* Short-lived access tokens (JWT, HS256). Role and assignedEventId travel in the token. Refresh tokens are opaque and live in the sessions collection. */
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@void/shared';
import { env } from '../config/env.js';

export interface AccessClaims { sub: string; role: Role; eid: string | null; mfa: boolean; name: string; email: string }

const key = () => new TextEncoder().encode(env.jwtAccessSecret);

export const signAccess = async (c: AccessClaims): Promise<string> =>
  new SignJWT({ role: c.role, eid: c.eid, mfa: c.mfa, name: c.name, email: c.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setIssuer('void-api')
    .setAudience('void')
    .setExpirationTime(`${env.accessTokenTtlSec}s`)
    .sign(key());

export const verifyAccess = async (token: string): Promise<AccessClaims> => {
  const { payload } = await jwtVerify(token, key(), { issuer: 'void-api', audience: 'void', algorithms: ['HS256'] });
  return { sub: String(payload.sub), role: payload.role as Role, eid: (payload.eid as string) ?? null, mfa: !!payload.mfa, name: String(payload.name ?? ''), email: String(payload.email ?? '') };
};
