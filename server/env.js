// Load .env before any module reads process.env (ESM imports hoist, so this
// module is imported first in index.js).
import path from 'node:path';

try {
  process.loadEnvFile(path.join(import.meta.dirname, '..', '.env'));
} catch {
  // No .env file — rely on the ambient environment.
}
