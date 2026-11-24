/* Every secret comes from the environment. In production a missing secret stops the server. */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bool = (v: string | undefined, d: boolean) => (v == null || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const list = (v: string | undefined, d: string[]) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test' || !!process.env.VITEST;

const missing: string[] = [];
const secret = (name: string, devFallback: () => string): string => {
  const v = process.env[name];
  if (v) return v;
  if (isProd) { missing.push(name); return ''; }
  return devFallback();
};
const ephemeral = () => randomBytes(32).toString('base64');

const here = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(here, '../..');
export const REPO_ROOT = path.resolve(API_ROOT, '../..');

export const env = {
  nodeEnv, isProd, isTest,
  port: Number(process.env.PORT || 4000),
  apiPublicUrl: (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, ''),
  /* In development the API serves the site itself, so links point back at the API's own origin. */
  webOrigin: (process.env.WEB_ORIGIN || (bool(process.env.SERVE_WEB, !isProd) ? process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}` : 'http://localhost:8000')).replace(/\/$/, ''),
  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:8000', 'http://localhost:4000', 'http://localhost:5173']),
  serveWeb: bool(process.env.SERVE_WEB, !isProd),
  webDir: process.env.WEB_DIR || path.join(REPO_ROOT, 'apps/web'),
  /** Demo mode turns on the simulated payment helpers under /api/v1/dev. Never on in production. */
  demoMode: !isProd && bool(process.env.DEMO_MODE, true),
  trustProxy: process.env.TRUST_PROXY || (isProd ? '1' : 'loopback'),

  mongoUri: process.env.MONGODB_URI || '',
  redisUrl: process.env.REDIS_URL || '',

  jwtAccessSecret: secret('JWT_ACCESS_SECRET', ephemeral),
  accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC || 900),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  requireMfa: bool(process.env.REQUIRE_MFA, isProd),
  hibpCheck: bool(process.env.HIBP_CHECK, isProd),
  /** Encrypts per-event QR signing keys and TOTP secrets at rest. 32 bytes, base64. */
  dataKey: secret('DATA_ENCRYPTION_KEY', ephemeral),

  payhere: {
    merchantId: secret('PAYHERE_MERCHANT_ID', () => '1211149'),
    merchantSecret: secret('PAYHERE_MERCHANT_SECRET', () => 'dev-merchant-secret'),
    sandbox: bool(process.env.PAYHERE_SANDBOX, !isProd),
    appId: process.env.PAYHERE_APP_ID || '',
    appSecret: process.env.PAYHERE_APP_SECRET || '',
  },
  koko: {
    driver: (process.env.KOKO_DRIVER || (isProd ? 'http' : 'mock')) as 'mock' | 'http',
    merchantId: process.env.KOKO_MERCHANT_ID || '',
    apiKey: process.env.KOKO_API_KEY || '',
    privateKey: (process.env.KOKO_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    publicKey: (process.env.KOKO_PUBLIC_KEY || '').replace(/\\n/g, '\n'),
    sandbox: bool(process.env.KOKO_SANDBOX, !isProd),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },
  mail: {
    driver: (process.env.MAIL_DRIVER || 'log') as 'log' | 'resend',
    resendKey: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || 'VOID <tickets@eventsbythevoid.lk>',
  },
  sms: {
    driver: (process.env.SMS_DRIVER || 'log') as 'log' | 'notifylk',
    notifyUserId: process.env.NOTIFYLK_USER_ID || '',
    notifyApiKey: process.env.NOTIFYLK_API_KEY || '',
    senderId: process.env.NOTIFYLK_SENDER_ID || 'NotifyDEMO',
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER || 'local') as 'local' | 's3',
    localDir: process.env.STORAGE_LOCAL_DIR || path.join(API_ROOT, 'uploads'),
    s3Endpoint: process.env.S3_ENDPOINT || '',
    s3Region: process.env.S3_REGION || 'auto',
    s3Bucket: process.env.S3_BUCKET || '',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    publicUrl: process.env.S3_PUBLIC_URL || '',
    maxFloorPlanBytes: 8 * 1024 * 1024,
    maxModelBytes: 40 * 1024 * 1024,
  },
  clamav: { host: process.env.CLAMAV_HOST || '', port: Number(process.env.CLAMAV_PORT || 3310) },
  sentryDsn: process.env.SENTRY_DSN || '',
};

if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}. See .env.example.`);
}
if (isProd && !env.mongoUri) throw new Error('MONGODB_URI is required in production.');
