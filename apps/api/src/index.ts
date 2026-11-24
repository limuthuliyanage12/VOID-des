import { startServer } from './server.js';

startServer().catch((e) => { console.error(e); process.exit(1); });
