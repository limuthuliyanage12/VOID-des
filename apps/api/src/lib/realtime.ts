/*
 * Socket.IO rooms:
 *   event.{id}   tier left counts, table status, paused state (public)
 *   split.{id}   share paid (public, ids are not guessable from the fan site)
 *   gate.{id}    checked-in count, staff online (organizer, gate staff of that event, or super admin)
 * Clients that can't hold a socket fall back to polling every 15 s.
 * The worker has no sockets of its own: it publishes on Redis and the API re-emits.
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { log } from './log.js';
import { verifyAccess, type AccessClaims } from './tokens.js';

const CHANNEL = 'void:realtime';
let io: Server | null = null;
let pub: import('ioredis').Redis | null = null;

export const canJoin = (room: string, c: AccessClaims | null): boolean => {
  const [kind, id] = room.split('.');
  if (!id || !/^[a-f\d]{24}$/i.test(id)) return false;
  if (kind === 'event' || kind === 'split') return true;
  if (kind === 'gate') return !!c && (c.role === 'super' || ((c.role === 'organizer' || c.role === 'gate') && c.eid === id));
  return false;
};

export const initRealtime = async (server: HttpServer) => {
  io = new Server(server, { path: '/socket.io', cors: { origin: env.corsOrigins, credentials: true }, serveClient: false });
  io.on('connection', async (socket) => {
    let claims: AccessClaims | null = null;
    const token = socket.handshake.auth?.token;
    if (typeof token === 'string' && token) claims = await verifyAccess(token).catch(() => null);
    socket.on('join', (room: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
      if (typeof room !== 'string' || !canJoin(room, claims)) return ack?.({ ok: false, error: 'You cannot join that room' });
      void socket.join(room); ack?.({ ok: true });
    });
    socket.on('leave', (room: unknown) => { if (typeof room === 'string') void socket.leave(room); });
  });
  if (env.redisUrl && !env.isTest) {
    const { Redis } = await import('ioredis');
    const sub = new Redis(env.redisUrl);
    await sub.subscribe(CHANNEL);
    sub.on('message', (_c, msg) => { try { const m = JSON.parse(msg); io?.to(m.room).emit(m.event, m.data); } catch { /* ignore */ } });
  }
  log.info('realtime ready');
  return io;
};

export const emit = (room: string, event: string, data: unknown) => {
  if (io) { io.to(room).emit(event, data); return; }
  if (!env.redisUrl || env.isTest) return;
  void (async () => {
    if (!pub) { const { Redis } = await import('ioredis'); pub = new Redis(env.redisUrl); }
    await pub.publish(CHANNEL, JSON.stringify({ room, event, data }));
  })().catch((e) => log.warn('realtime publish failed', { error: e }));
};

export const closeRealtime = async () => { await io?.close(); io = null; pub?.disconnect(); pub = null; };
