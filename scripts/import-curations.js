// Import the local JSON-file collection into the configured hosted database.
//
// Usage:
//   DATABASE_URL='postgresql://...' node scripts/import-curations.js

import '../server/env.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  closeCurationStore,
  databasePersistenceEnabled,
  initCurationStore,
  saveCuration,
} from '../server/curations.js';

if (!databasePersistenceEnabled()) {
  throw new Error('DATABASE_URL is required.');
}

const dataDir = path.join(import.meta.dirname, '..', 'data', 'curations');
const files = fs.readdirSync(dataDir).filter((file) => file.endsWith('.json'));

await initCurationStore();
for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  const curation = {
    ...raw,
    records: new Map((raw.records ?? []).map((record) => [record.id, record])),
    research: raw.research ?? [],
    logs: raw.logs ?? [],
    topicMap: raw.topicMap ?? '',
  };
  await saveCuration(curation);
  console.log(`imported ${curation.id}`);
}
await closeCurationStore();
console.log(`done — ${files.length} curations imported`);
