// Curations: the persistence spine (spec v0.2 §3).
//
// A curation is a saved, mutable state of the canvas — not a query string.
// It freezes the fetched object set (so restores never re-fetch and survive
// drifting search results) and carries the tldraw snapshot so a reopened
// curation is exactly as it was left. Local development stores one JSON file
// per curation. Hosted deployments use Postgres when DATABASE_URL is set,
// keeping the same serialized document shape in a JSONB column.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const DATA_DIR = path.join(import.meta.dirname, '..', 'data', 'curations');

const cache = new Map(); // id -> live curation (records as Map)
const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? '';
let pool;
let initialization;
let fileStoreReady = false;

const safeId = (id) => /^[a-zA-Z0-9-]{1,80}$/.test(String(id));
const fileFor = (id) => path.join(DATA_DIR, `${id}.json`);
const ensureFileStore = () => {
  if (fileStoreReady) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fileStoreReady = true;
};

function serialize(c) {
  return {
    id: c.id,
    title: c.title,
    query: c.query,
    seeded: c.seeded,
    createdAt: c.createdAt,
    modifiedAt: c.modifiedAt,
    records: [...c.records.values()],
    agentLayout: c.agentLayout,
    synthesis: c.synthesis,
    research: c.research,
    activeAxis: c.activeAxis,
    snapshot: c.snapshot,
    logs: c.logs ?? [],
    topicMap: c.topicMap ?? '',
  };
}

function deserialize(raw) {
  return {
    ...raw,
    records: new Map((raw.records ?? []).map((r) => [r.id, r])),
    research: raw.research ?? [],
    logs: raw.logs ?? [],
    topicMap: raw.topicMap ?? '',
  };
}

function metadata(c) {
  return {
    id: c.id,
    title: c.title,
    query: c.query,
    seeded: c.seeded,
    createdAt: c.createdAt,
    modifiedAt: c.modifiedAt,
    count: c.records.size,
    covers: [...c.records.values()]
      .slice(0, 10)
      .map((r) => ({ image: r.image, title: r.title })),
  };
}

export const databasePersistenceEnabled = () => Boolean(DATABASE_URL);

export async function initCurationStore() {
  if (!DATABASE_URL) {
    ensureFileStore();
    return;
  }
  if (initialization) return initialization;

  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  initialization = pool.query(`
    CREATE TABLE IF NOT EXISTS gallery_curations (
      id TEXT PRIMARY KEY,
      modified_at BIGINT NOT NULL,
      seeded BOOLEAN NOT NULL DEFAULT FALSE,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gallery_curations_modified_at_idx
      ON gallery_curations (modified_at DESC);
  `);
  await initialization;
}

export async function closeCurationStore() {
  if (pool) await pool.end();
  pool = undefined;
  initialization = undefined;
}

export function createCuration({ query, title, seeded = false, id } = {}) {
  const c = {
    id: id ?? randomUUID(),
    title: title || query || 'Untitled curation',
    query: query ?? '',
    seeded,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    records: new Map(),
    agentLayout: null,
    synthesis: '',
    research: [],
    activeAxis: null,
    snapshot: null,
    logs: [],
    topicMap: '',
  };
  cache.set(c.id, c);
  return c;
}

export async function getCuration(id) {
  if (!safeId(id)) return null;
  if (cache.has(id)) return cache.get(id);

  if (DATABASE_URL) {
    await initCurationStore();
    const result = await pool.query('SELECT data FROM gallery_curations WHERE id = $1', [id]);
    if (!result.rowCount) return null;
    const c = deserialize(result.rows[0].data);
    cache.set(id, c);
    return c;
  }

  ensureFileStore();
  try {
    const raw = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
    const c = deserialize(raw);
    cache.set(id, c);
    return c;
  } catch {
    return null;
  }
}

export async function saveCuration(c) {
  const data = serialize(c);
  cache.set(c.id, c);

  if (DATABASE_URL) {
    await initCurationStore();
    await pool.query(
      `INSERT INTO gallery_curations (id, modified_at, seeded, data)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         modified_at = EXCLUDED.modified_at,
         seeded = EXCLUDED.seeded,
         data = EXCLUDED.data`,
      [c.id, c.modifiedAt, c.seeded, JSON.stringify(data)]
    );
    return;
  }

  ensureFileStore();
  const json = JSON.stringify(data);
  const tmp = fileFor(c.id) + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, fileFor(c.id));
}

export async function updateCuration(id, patch) {
  const c = await getCuration(id);
  if (!c) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) c.title = patch.title.trim();
  if (patch.snapshot !== undefined) c.snapshot = patch.snapshot;
  if (patch.activeAxis !== undefined) c.activeAxis = patch.activeAxis;
  c.modifiedAt = Date.now();
  await saveCuration(c);
  return c;
}

export async function deleteCuration(id) {
  const c = await getCuration(id);
  if (!c || c.seeded) return false;

  if (DATABASE_URL) {
    await initCurationStore();
    await pool.query('DELETE FROM gallery_curations WHERE id = $1', [id]);
  } else {
    ensureFileStore();
    fs.rmSync(fileFor(id), { force: true });
  }
  cache.delete(id);
  return true;
}

// Homepage list: meta only, newest-modified first. Covers power the preview grid.
export async function listCurations() {
  if (DATABASE_URL) {
    await initCurationStore();
    const result = await pool.query(
      'SELECT data FROM gallery_curations ORDER BY modified_at DESC'
    );
    return result.rows.map(({ data }) => {
      const c = deserialize(data);
      cache.set(c.id, c);
      return metadata(c);
    });
  }

  ensureFileStore();
  const out = [];
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    const c = await getCuration(id);
    if (!c) continue;
    out.push(metadata(c));
  }
  out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return out;
}
