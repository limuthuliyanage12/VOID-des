import { createServer } from 'node:http';
import { env } from './config/env.js';
import { connectDb, disconnectDb, syncIndexes } from './db/connect.js';
import { registerJobs, startSchedule } from './jobs/registry.js';
import { jobs, usingRedis } from './lib/jobs.js';
import { log } from './lib/log.js';
import { closeRealtime, initRealtime } from './lib/realtime.js';
import { createApp } from './app.js';

export const startServer = async (mongoUri = env.mongoUri) => {
  if (!mongoUri) throw new Error('Set MONGODB_URI, or run `pnpm dev:mem` for an in-memory database.');
  await connectDb(mongoUri);
  await syncIndexes();
  registerJobs();
  /* Without Redis, this process runs the jobs and the schedule itself. */
  if (!usingRedis()) await startSchedule();
  const server = createServer(createApp());
  await initRealtime(server);
  await new Promise<void>((r) => server.listen(env.port, r));
  log.info('api listening', { url: env.apiPublicUrl, jobs: usingRedis() ? 'bullmq (run the worker)' : 'in-process', demoMode: env.demoMode });
  const stop = async () => { log.info('shutting down'); server.close(); await closeRealtime(); await jobs.close(); await disconnectDb(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return server;
};
