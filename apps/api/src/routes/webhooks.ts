/* Provider callbacks. No auth: the signature is the check. Answer fast; the job does the work. */
import { Router } from 'express';
import { handleKokoCallback, handlePayhereNotify } from '../modules/payments/service.js';

export const webhookRoutes = Router();

webhookRoutes.post('/payhere', async (req, res) => {
  const r = await handlePayhereNotify(req.body ?? {});
  res.status(r.httpStatus).type('text').send(r.result);
});

webhookRoutes.post('/koko', async (req, res) => {
  const sig = req.header('X-Koko-Signature') ?? String(req.body?.signature ?? '');
  const r = await handleKokoCallback(req.rawBody ?? JSON.stringify(req.body ?? {}), sig, req.body ?? {});
  res.status(r.httpStatus).type('text').send(r.result);
});
