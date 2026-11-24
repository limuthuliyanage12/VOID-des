import { startWorker } from '@void/api/worker';

startWorker().catch((e) => { console.error(e); process.exit(1); });
