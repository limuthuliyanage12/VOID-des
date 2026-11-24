/* Each test file gets its own database on the shared replica set, freshly seeded. */
import { afterAll, beforeAll, inject } from 'vitest';
import mongoose from 'mongoose';

beforeAll(async () => {
  const base = inject('mongoUri');
  const db = `void_test_${Math.random().toString(36).slice(2, 10)}`;
  const uri = base.replace(/\/(\?|$)/, `/${db}$1`);
  const { connectDb, syncIndexes } = await import('../src/db/connect.js');
  await connectDb(uri);
  await syncIndexes();
  const { registerJobs } = await import('../src/jobs/registry.js');
  registerJobs();
  const { seed } = await import('../src/seed/seed.js');
  await seed();
});

afterAll(async () => {
  const { jobs } = await import('../src/lib/jobs.js');
  await jobs.close();
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});
