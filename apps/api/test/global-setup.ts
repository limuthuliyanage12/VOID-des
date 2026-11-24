/* One in-memory MongoDB replica set for the whole run (transactions need a replica set). */
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject) {
  process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(os.homedir(), '.cache', 'mongodb-binaries');
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', rs.getUri());
  return async () => { await rs.stop(); };
}

declare module 'vitest' {
  export interface ProvidedContext { mongoUri: string }
}
