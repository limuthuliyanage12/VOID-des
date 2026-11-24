import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import mongoose from 'mongoose';
import { AppError, isDupKey } from '../lib/errors.js';
import { log } from '../lib/log.js';

/** Parse with a shared zod schema, or throw a 400 with the field issues. */
export const parse = <S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> => {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, 'VALIDATION', 'Check the highlighted fields', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof AppError) return void res.status(err.status).json({ code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
  if (err instanceof ZodError) return void res.status(400).json({ code: 'VALIDATION', message: 'Check the highlighted fields', details: err.issues });
  if (err instanceof mongoose.Error.CastError) return void res.status(400).json({ code: 'BAD_ID', message: `That ${err.path} is not valid` });
  if (err instanceof mongoose.Error.ValidationError) return void res.status(400).json({ code: 'VALIDATION', message: err.message });
  if (isDupKey(err)) return void res.status(409).json({ code: 'DUPLICATE', message: 'That already exists' });
  const e = err as { type?: string; status?: number; code?: string; message?: string };
  if (e.type === 'entity.parse.failed') return void res.status(400).json({ code: 'BAD_JSON', message: 'The request body is not valid JSON' });
  if (e.type === 'entity.too.large') return void res.status(413).json({ code: 'TOO_LARGE', message: 'The request body is too large' });
  if (e.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({ code: 'TOO_LARGE', message: 'That file is too large' });
  log.error('unhandled error', { method: req.method, path: req.path, error: err });
  res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong on our side. Try again in a moment.' });
};
