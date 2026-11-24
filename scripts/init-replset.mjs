// Initiates the single-node replica set rs0 on localhost:27017 (MongoDB service or Docker), then waits for a primary.
// Safe to run again. Uses the MongoDB driver that ships with mongoose, so mongosh is not needed.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { MongoClient } = require('mongodb');

const host = process.argv[2] || 'localhost:27017';
const client = new MongoClient(`mongodb://${host}/?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
await client.connect();
const admin = client.db('admin');
try {
  const s = await admin.command({ replSetGetStatus: 1 });
  console.log(`Replica set ${s.set} is already running.`);
} catch (e) {
  if (e.codeName === 'NoReplicationEnabled') {
    console.error('MongoDB is running without replication. Run scripts/setup-sandbox-admin.ps1 as administrator first.');
    process.exit(1);
  }
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host }] } });
  console.log('Replica set rs0 initiated.');
}
for (let i = 0; i < 30; i++) {
  const hello = await admin.command({ hello: 1 });
  if (hello.isWritablePrimary) { console.log(`Primary ready. Use MONGODB_URI=mongodb://${host}/void?replicaSet=rs0&directConnection=true`); break; }
  await new Promise((r) => setTimeout(r, 1000));
}
await client.close();
