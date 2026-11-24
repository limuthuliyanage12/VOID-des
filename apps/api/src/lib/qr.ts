/*
 * QR tickets. Each QR holds a compact token signed with the event's Ed25519 key:
 *   V1.<base64url(JSON {t, e, a, k, q})>.<base64url(signature)>
 * t ticket id, e event id, a admits, k key version, q the ticket's QR version (bumped on transfer).
 * The scanner checks the signature offline with the event's public key. The server still decides "already used".
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import QRCode from 'qrcode';
import type { ClientSession, Types } from 'mongoose';
import { EventKey } from '../db/models/index.js';
import { decrypt, encrypt } from './crypto.js';

export interface QrPayload { t: string; e: string; a: number; k: number; q: number }

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export const newKeyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    /** The raw 32-byte public key, base64url. This is what the scanner app stores. */
    publicKey: publicKey.export({ format: 'jwk' }).x as string,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};

const pubFromRaw = (x: string): KeyObject => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });

export const signPayload = (p: QrPayload, privateKeyPem: string): string => {
  const body = b64u(JSON.stringify(p));
  const sig = sign(null, Buffer.from(body), createPrivateKey(privateKeyPem));
  return `V1.${body}.${b64u(sig)}`;
};

/** Returns the payload when the signature is good for one of the given public keys, else null. */
export const verifyToken = (token: string, publicKeys: Record<number, string>): QrPayload | null => {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'V1') return null;
  let p: QrPayload;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.t !== 'string' || typeof p.e !== 'string' || typeof p.k !== 'number') return null;
  const pub = publicKeys[p.k];
  if (!pub) return null;
  try { return verify(null, Buffer.from(parts[1]), pubFromRaw(pub), Buffer.from(parts[2], 'base64url')) ? p : null; } catch { return null; }
};

/** Reads the payload without checking it. Only to find which event's keys to check against. */
export const peekToken = (token: string): QrPayload | null => {
  try { const p = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')); return p && typeof p.e === 'string' ? p : null; } catch { return null; }
};

/* ---------- Per-event key store. Keys rotate per event; old versions stay valid until retired. ---------- */
export const ensureEventKey = async (eventId: Types.ObjectId | string, session?: ClientSession) => {
  const active = await EventKey.findOne({ eventId, active: true }, null, { session }).sort({ version: -1 });
  if (active) return active;
  const kp = newKeyPair();
  const [created] = await EventKey.create([{ eventId, version: 1, publicKey: kp.publicKey, privateKeyEnc: encrypt(kp.privateKeyPem), active: true }], { session });
  return created;
};

export const rotateEventKey = async (eventId: Types.ObjectId | string, retireOld = false) => {
  const last = await EventKey.findOne({ eventId }).sort({ version: -1 });
  const kp = newKeyPair();
  if (retireOld) await EventKey.updateMany({ eventId }, { $set: { active: false, retiredAt: new Date() } });
  return EventKey.create({ eventId, version: (last?.version ?? 0) + 1, publicKey: kp.publicKey, privateKeyEnc: encrypt(kp.privateKeyPem), active: true });
};

/** Every non-retired public key for an event, by version. This is what the scanner downloads. */
export const eventPublicKeys = async (eventId: Types.ObjectId | string): Promise<Record<number, string>> => {
  const keys = await EventKey.find({ eventId, retiredAt: null }).lean();
  return Object.fromEntries(keys.map((k) => [k.version, k.publicKey]));
};

export const tokenForTicket = async (t: { _id: Types.ObjectId; eventId: Types.ObjectId; admits: number; qrSecretVersion: number }) => {
  const key = await ensureEventKey(t.eventId);
  return signPayload({ t: String(t._id), e: String(t.eventId), a: t.admits, k: key.version, q: t.qrSecretVersion }, decrypt(key.privateKeyEnc));
};

export const qrSvg = (token: string) => QRCode.toString(token, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
export const qrMatrix = (token: string) => {
  const q = QRCode.create(token, { errorCorrectionLevel: 'M' });
  return { size: q.modules.size, get: (x: number, y: number) => !!q.modules.get(y, x) };
};
