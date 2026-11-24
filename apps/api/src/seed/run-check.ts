/* pnpm seed:check: checks the sums in an already-seeded database without changing it. */
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { seedCheck } from './check.js';

await connectDb(env.mongoUri);
const checks = await seedCheck();
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `  got ${JSON.stringify(c.got)} want ${JSON.stringify(c.want)}`}`);
await disconnectDb();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
