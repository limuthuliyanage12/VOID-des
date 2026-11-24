/*
 * Writes a person might retry take an Idempotency-Key header. The first request runs; a repeat with the same key
 * gets the stored response back; a repeat while the first is still running gets 409. Server errors are not stored,
 * so a retry after a 500 runs again.
 */
import type { RequestHandler } from 'express';
import { IdempotencyKey } from '../db/models/index.js';
import { AppError, badRequest, isDupKey } from '../lib/errors.js';

export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.header('Idempotency-Key');
  if (!key) return next();
  if (!/^[\w-]{8,128}$/.test(key)) throw badRequest('Idempotency-Key must be 8 to 128 letters, digits, dashes or underscores');
  const scope = req.auth?.sub ?? req.ip ?? 'anon';
  const route = `${req.method} ${req.baseUrl}${req.path}`;
  try {
    await IdempotencyKey.create({ key, scope, route });
  } catch (e) {
    if (!isDupKey(e)) throw e;
    const prev = await IdempotencyKey.findOne({ key, scope, route }).lean();
    if (prev?.state === 'done') { res.setHeader('Idempotent-Replayed', 'true'); return void res.status(prev.statusCode ?? 200).json(prev.body); }
    throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed');
  }
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const done = res.statusCode < 500
      ? IdempotencyKey.updateOne({ key, scope, route }, { $set: { state: 'done', statusCode: res.statusCode, body } })
      : IdempotencyKey.deleteOne({ key, scope, route });
    void done.catch(() => undefined);
    return json(body);
  };
  next();
};
