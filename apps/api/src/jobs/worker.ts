/* Entry used by apps/worker: connects, registers handlers, starts the BullMQ worker and the repeating schedule. */
import { env } from '../config/env.js';
import { connectDb } from '../db/connect.js';
import { jobs, usingRedis } from '../lib/jobs.js';
import { log } from '../lib/log.js';
import { registerJobs, startSchedule } from './registry.js';

export const startWorker = async () => {
  if (!usingRedis()) throw new Error('The worker needs REDIS_URL. Without Redis the API runs jobs in-process.');
  await connectDb(env.mongoUri);
  registerJobs();
  await jobs.startWorker(Number(process.env.WORKER_CONCURRENCY || 8));
  await startSchedule();
  log.info('worker ready');
  const stop = async () => { await jobs.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
};
