/*
 * pnpm dev:mem: a throwaway MongoDB replica set in memory, seeded with the prototype's data, and the API on top.
 * Nothing to install beyond Node. Data is gone when you stop it.
 */
import os from 'node:os';
import path from 'node:path';
process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(os.homedir(), '.cache', 'mongodb-binaries');

const { MongoMemoryReplSet } = await import('mongodb-memory-server');
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = rs.getUri('void');
const { connectDb, syncIndexes } = await import('./db/connect.js');
await connectDb(uri);
await syncIndexes();
const { seed } = await import('./seed/seed.js');
const out = await seed();
const { startServer } = await import('./server.js');
await startServer(uri);
console.log('\nIn-memory database seeded. Demo accounts:\n' + out.accounts.map((a) => `  ${a.role.padEnd(10)} ${a.email.padEnd(34)} ${a.password}${a.totpSecret ? `  TOTP ${a.totpSecret}` : ''}`).join('\n') + '\n');
process.on('exit', () => { void rs.stop(); });
