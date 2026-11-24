import mongoose, { type ClientSession } from 'mongoose';
import { log } from '../lib/log.js';

mongoose.set('strictQuery', true);

export const connectDb = async (uri: string): Promise<typeof mongoose> => {
  if (mongoose.connection.readyState === 1) return mongoose;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: true });
  log.info('mongo connected', { host: mongoose.connection.host, db: mongoose.connection.name });
  return mongoose;
};

export const disconnectDb = async () => { await mongoose.disconnect(); };

/** Makes sure every model's indexes exist. Transactions can't create collections on older servers, so do this at boot. */
export const syncIndexes = async () => {
  for (const m of Object.values(mongoose.models)) {
    await m.createCollection().catch(() => undefined);
    await m.syncIndexes();
  }
};

/**
 * Runs fn in a transaction. The driver retries on transient errors and unknown commit results,
 * so fn must be safe to run more than once: only conditional updates, no side effects outside the DB.
 */
export const tx = async <T>(fn: (session: ClientSession) => Promise<T>): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => { out = await fn(session); }, {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
    });
    return out;
  } finally {
    await session.endSession();
  }
};
