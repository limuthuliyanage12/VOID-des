/* pnpm seed: wipes the database in MONGODB_URI and seeds it, then runs the seed check. */
import { env } from '../config/env.js';
import { connectDb, disconnectDb, syncIndexes } from '../db/connect.js';
import { seedCheck } from './check.js';
import { seed } from './seed.js';

await connectDb(env.mongoUri || (() => { throw new Error('Set MONGODB_URI first'); })());
await syncIndexes();
const out = await seed();
const checks = await seedCheck();
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `  got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`}`);
console.log('\nDemo accounts:\n' + out.accounts.map((a) => `  ${a.role.padEnd(10)} ${a.email.padEnd(40)} ${a.password}${a.note ? `  (${a.note})` : ''}`).join('\n'));
await disconnectDb();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
