import './env.js';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { runAgent, finishCuration } from './agent.js';
import {
  createCuration,
  databasePersistenceEnabled,
  deleteCuration,
  getCuration,
  initCurationStore,
  saveCuration,
  updateCuration,
  listCurations,
} from './curations.js';
import { groupRecords, MANUAL_AXES } from './grouping.js';
import { inferenceConfigured, getModel } from './inference.js';
import { braveConfigured } from './research/brave.js';
import { askQuestion } from './ask.js';

const PORT = Number(process.env.PORT || 3017);
const DIST = path.join(import.meta.dirname, '..', 'dist');
const SITE_PASSWORD = process.env.SITE_PASSWORD ?? '';
const SITE_USERNAME = process.env.SITE_USERNAME || 'gallery';

const app = express();
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function credentialsMatch(provided, expected) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

// A shared password is optional locally and strongly recommended whenever the
// gallery is public: its agent endpoints consume paid inference/search APIs.
app.use((req, res, next) => {
  if (!SITE_PASSWORD || req.path === '/api/health') return next();
  const [scheme, encoded] = String(req.headers.authorization ?? '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = separator === -1 ? '' : decoded.slice(0, separator);
    const password = separator === -1 ? '' : decoded.slice(separator + 1);
    if (
      credentialsMatch(username, SITE_USERNAME) &&
      credentialsMatch(password, SITE_PASSWORD)
    ) {
      return next();
    }
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="copyleft.gallery", charset="UTF-8"');
  res.status(401).send('Authentication required.');
});

// tldraw snapshots for a full canvas run a few hundred KB
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', async (req, res) => {
  const health = {
    ok: true,
    inferenceConfigured: inferenceConfigured(),
    webSearchConfigured: braveConfigured(),
    persistence: databasePersistenceEnabled() ? 'postgres' : 'files',
    passwordProtected: Boolean(SITE_PASSWORD),
  };
  if (health.inferenceConfigured) {
    try {
      health.model = await getModel();
    } catch (err) {
      health.ok = false;
      health.modelError = err.message;
    }
  }
  res.json(health);
});

// The main event stream. POST is the primary transport: Cloudflare quick
// tunnels buffer GET SSE responses until close but stream POST in real time
// (cloudflare/cloudflared#1449). GET kept for curl/debugging.
// Events: session, thought (streamed agent prose), status, research, card, layout, error, done.
// Every query creates a curation — the persistence spine (spec v0.2 §3).
const agentHandler = async (req, res) => {
  const query = String((req.method === 'POST' ? req.body?.q : req.query.q) ?? '').trim();
  if (!query) return res.status(400).json({ error: 'q is required' });
  if (!inferenceConfigured()) {
    return res.status(503).json({ error: 'NEURALWATT_API_KEY is not configured on the server.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': hb\n\n');
  }, 15_000);

  const abort = new AbortController();
  // res 'close', not req: a POST's request stream closes as soon as its body
  // is consumed, which would abort the agent instantly. The response closes
  // only when the client actually disconnects.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  const curation = createCuration({ query });
  emit('session', { curationId: curation.id, query });

  try {
    await runAgent({ session: curation, emit, signal: abort.signal });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error('[agent]', err);
      emit('error', { message: err.message });
    }
  } finally {
    clearInterval(heartbeat);
    curation.modifiedAt = Date.now();
    if (curation.records.size > 0) await saveCuration(curation);
    emit('done', { objectCount: curation.records.size });
    res.end();
  }
};
app.post('/api/agent', agentHandler);
app.get('/api/agent', agentHandler);

// Layout-only regroup over the curation's frozen record set. No re-fetch.
app.post('/api/regroup', asyncHandler(async (req, res) => {
  const { curationId, axis } = req.body ?? {};
  const curation = await getCuration(curationId);
  if (!curation) return res.status(404).json({ error: 'Unknown curation.' });
  if (!MANUAL_AXES.includes(axis)) {
    return res.status(400).json({ error: `axis must be one of ${MANUAL_AXES.join(', ')}` });
  }
  const layout = groupRecords([...curation.records.values()], axis);
  res.json({ ...layout, source: 'manual' });
}));

// Homepage list: recent curations by last-modified + seeded exhibitions.
app.get('/api/curations', asyncHandler(async (req, res) => {
  res.json(await listCurations());
}));

app.get('/api/curations/:id', asyncHandler(async (req, res) => {
  const curation = await getCuration(req.params.id);
  if (!curation) return res.status(404).json({ error: 'Unknown curation.' });
  res.json({
    id: curation.id,
    title: curation.title,
    query: curation.query,
    seeded: curation.seeded,
    createdAt: curation.createdAt,
    modifiedAt: curation.modifiedAt,
    records: [...curation.records.values()],
    agentLayout: curation.agentLayout,
    synthesis: curation.synthesis,
    research: curation.research,
    activeAxis: curation.activeAxis,
    snapshot: curation.snapshot,
    logs: curation.logs ?? [],
    topicMap: curation.topicMap ?? '',
  });
}));

// Autosave / rename. No accounts, no permissions — seeded exhibitions are
// shared instances, and edits to them stick for everyone (spec v0.2 §4).
app.patch('/api/curations/:id', asyncHandler(async (req, res) => {
  const { title, snapshot, activeAxis } = req.body ?? {};
  const curation = await updateCuration(req.params.id, { title, snapshot, activeAxis });
  if (!curation) return res.status(404).json({ error: 'Unknown curation.' });
  res.json({ ok: true, modifiedAt: curation.modifiedAt });
}));

// Finish an interrupted curation: layout-only pass over the frozen records.
app.post('/api/curations/:id/finish', asyncHandler(async (req, res) => {
  const curation = await getCuration(req.params.id);
  if (!curation) return res.status(404).json({ error: 'Unknown curation.' });
  if (!curation.records.size) return res.status(400).json({ error: 'No records to hang.' });
  if (!inferenceConfigured()) return res.status(503).json({ error: 'Inference not configured.' });
  try {
    const layout = await finishCuration({ curation });
    // stale partial snapshot would shadow the fixed layout — drop it so the
    // next open materializes fresh
    curation.snapshot = null;
    curation.modifiedAt = Date.now();
    await saveCuration(curation);
    res.json(layout);
  } catch (err) {
    console.error('[finish]', err);
    res.status(500).json({ error: err.message });
  }
}));

// Ask Question / Ask About — answers land on the canvas as panels.
app.post('/api/ask', asyncHandler(async (req, res) => {
  const { curationId, question, objectId } = req.body ?? {};
  const curation = await getCuration(curationId);
  if (!curation) return res.status(404).json({ error: 'Unknown curation.' });
  const q = String(question ?? '').trim();
  if (!q) return res.status(400).json({ error: 'question is required' });
  if (!inferenceConfigured()) {
    return res.status(503).json({ error: 'Inference is not configured.' });
  }
  try {
    const record = objectId ? curation.records.get(String(objectId)) : undefined;
    const result = await askQuestion({ curation, question: q, record });
    res.json(result);
  } catch (err) {
    console.error('[ask]', err);
    res.status(500).json({ error: err.message });
  }
}));

app.delete('/api/curations/:id', asyncHandler(async (req, res) => {
  const curation = await getCuration(req.params.id);
  if (!curation) return res.status(404).json({ error: 'Unknown curation.' });
  if (curation.seeded) {
    return res.status(403).json({ error: 'Seeded exhibitions cannot be deleted.' });
  }
  await deleteCuration(req.params.id);
  res.status(204).end();
}));

// Hashed assets can cache forever; index.html must never be cached or a
// rebuild strands clients on a stale bundle.
app.use(
  express.static(DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[http]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error.' });
});

await initCurationStore();
app.listen(PORT, () => {
  console.log(`copyleft gallery listening on http://localhost:${PORT}`);
  if (!inferenceConfigured()) {
    console.warn('⚠ NEURALWATT_API_KEY missing — queries will fail until .env is filled in.');
  }
});
