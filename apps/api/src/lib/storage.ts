/*
 * Files: floor plans (JPG, PNG), venue models (GLB) and event art. Local disk in development, S3-compatible (R2 or S3) in production.
 * Every upload is checked by its first bytes, size-limited and virus-scanned with ClamAV when CLAMAV_HOST is set.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { env } from '../config/env.js';
import { randomToken } from './crypto.js';
import { AppError, badRequest } from './errors.js';
import { log } from './log.js';

export type UploadKind = 'floor-plan' | 'model' | 'art';
const KINDS: Record<UploadKind, { types: ('jpg' | 'png' | 'glb' | 'webp')[]; max: number }> = {
  'floor-plan': { types: ['jpg', 'png'], max: env.storage.maxFloorPlanBytes },
  model: { types: ['glb'], max: env.storage.maxModelBytes },
  art: { types: ['jpg', 'png', 'webp'], max: env.storage.maxFloorPlanBytes },
};
const MIME = { jpg: 'image/jpeg', png: 'image/png', glb: 'model/gltf-binary', webp: 'image/webp' } as const;

export const sniff = (b: Buffer): keyof typeof MIME | null => {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'glTF') return 'glb';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
};

/** clamd INSTREAM. Resolves true when clean. */
const clamScan = (buf: Buffer): Promise<boolean> => new Promise((resolve, reject) => {
  const sock = net.connect(env.clamav.port, env.clamav.host);
  let reply = '';
  sock.setTimeout(20_000, () => { sock.destroy(); reject(new Error('virus scan timed out')); });
  sock.on('connect', () => {
    sock.write('zINSTREAM\0');
    for (let i = 0; i < buf.length; i += 64 * 1024) {
      const chunk = buf.subarray(i, i + 64 * 1024), len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
      sock.write(len); sock.write(chunk);
    }
    sock.write(Buffer.alloc(4));
  });
  sock.on('data', (d) => { reply += d.toString(); });
  sock.on('end', () => resolve(/OK\0?$/.test(reply.trim())));
  sock.on('error', reject);
});

export const checkUpload = async (kind: UploadKind, buf: Buffer) => {
  const rule = KINDS[kind];
  if (buf.length > rule.max) throw new AppError(413, 'TOO_LARGE', `That file is over ${Math.round(rule.max / 1024 / 1024)} MB`);
  const type = sniff(buf);
  if (!type || !rule.types.includes(type as never)) throw badRequest(`Upload a ${rule.types.map((t) => t.toUpperCase()).join(' or ')} file`);
  if (env.clamav.host) {
    const clean = await clamScan(buf).catch((e) => { log.error('virus scan failed', { error: e }); throw new AppError(503, 'SCAN_UNAVAILABLE', 'The virus scanner is not reachable. Try again shortly.'); });
    if (!clean) throw badRequest('That file did not pass the virus scan');
  } else if (env.isProd) {
    throw new AppError(503, 'SCAN_UNAVAILABLE', 'Uploads are off until a virus scanner is configured (CLAMAV_HOST).');
  }
  return { type, contentType: MIME[type] };
};

let s3: { send: (cmd: unknown) => Promise<unknown> } | null = null;
const s3Client = async () => {
  if (s3) return s3;
  const { S3Client } = await import('@aws-sdk/client-s3');
  s3 = new S3Client({ region: env.storage.s3Region, endpoint: env.storage.s3Endpoint || undefined, credentials: { accessKeyId: env.storage.s3AccessKeyId, secretAccessKey: env.storage.s3SecretAccessKey } }) as never;
  return s3!;
};

/** Stores a checked upload and returns its public URL. */
export const putFile = async (kind: UploadKind, owner: string, buf: Buffer): Promise<{ url: string; key: string; contentType: string }> => {
  const { type, contentType } = await checkUpload(kind, buf);
  const key = `${kind}/${owner}/${Date.now()}-${randomToken(6)}.${type}`;
  if (env.storage.driver === 's3') {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3Client()).send(new PutObjectCommand({ Bucket: env.storage.s3Bucket, Key: key, Body: buf, ContentType: contentType }));
    return { url: `${env.storage.publicUrl.replace(/\/$/, '')}/${key}`, key, contentType };
  }
  const file = path.join(env.storage.localDir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  return { url: `${env.apiPublicUrl}/uploads/${key}`, key, contentType };
};
