# copyleft.gallery

A spatial art research canvas — v0.2. Two doors in (the **generous interface**): a search box for "I know what I want," and an auto-scrolling preview wall of pre-seeded exhibitions for "show me." A query sends a single AI research agent off to ground itself on Wikipedia and live-search **four museum open-collection APIs**, streaming results onto a **tldraw** canvas as wall-label cards, then hanging the show along whatever axis it judges most meaningful — with exhibition-style labels, a note per group, and a synthesis. Off-topic catches get discarded, not hung.

Everything you do to a canvas **persists**: every search becomes a **curation** — a saved, mutable canvas state. Move cards, delete them, re-group, scribble annotations with tldraw's tools, rename the show — reopen it from the homepage's "your recent curations" and it's exactly as you left it. Restores never re-run the query: the fetched object set is frozen inside the curation. Representation is mutable; now it's also durable.

**v0.2 is private/local only — no public tunnel.**

## Run it

```bash
./start.sh
```

Installs dependencies, builds the frontend, seeds the five exhibitions on first run (needs the API key; a few minutes), and serves **http://localhost:3017**. Local only.

First run only: put your Neuralwatt API key in `.env` (the script copies `.env.example` into place if `.env` is missing):

```bash
cp .env.example .env   # then fill in NEURALWATT_API_KEY
```

### Prerequisites

- Node 20.11+ (uses `process.loadEnvFile` and `import.meta.dirname`)

### Other ways to run

```bash
npm run dev           # dev mode: Express on :3017 + Vite HMR on :5173 (proxies /api)
npm run build         # build frontend to dist/
npm start             # serve built app on :3017
node scripts/seed.js  # (re)generate seeded exhibitions; --force to redo existing
```

## Curations & persistence (v0.2 §3)

- Every query creates a curation server-side; the SSE `session` event hands the client its id, and the URL becomes `#/c/<id>`.
- The canvas autosaves: any tldraw document change (moves, deletions, annotations, regroups) debounces into `PATCH /api/curations/:id` with `editor.getSnapshot()`. Restore is `editor.loadSnapshot` — arrangement, kept/removed set, annotations, and camera come back exactly.
- The record set (object metadata + image URLs) is frozen in the curation, so restores don't re-fetch and survive drifting search results. Manual re-grouping works offline from that frozen set.
- Storage is plain JSON files in `data/curations/` — single local user, no accounts.
- **Seeded exhibitions are shared instances.** No permissions: anyone's edits stick for everyone. Graffiti, yo. (Concurrent edits are last-write-wins.)
- Homepage lists non-empty curations by last-modified with relative timestamps; seeded shows power the preview wall and the tile "leap into an exhibition" path.
- Theme: dark by default, light via the toggle (persisted in localStorage).

## Inference — Neuralwatt

All LLM calls go through the [Neuralwatt](https://portal.neuralwatt.com/docs) inference API, which is OpenAI-compatible, so the app uses the standard `openai` client pointed at the Neuralwatt base URL (see `server/inference.js` — the one module that knows which provider is behind it). Tool calling and streaming use the stock OpenAI chat-completions format; no adaptation was needed.

| Env var | Meaning |
| --- | --- |
| `NEURALWATT_API_BASE` | API base URL. Default `https://api.neuralwatt.com/v1` |
| `NEURALWATT_API_KEY` | **Required.** From portal.neuralwatt.com → API Keys. Keys are `sk-`-prefixed — include the prefix |
| `NEURALWATT_MODEL` | Optional. Default in `.env` is `kimi-k2.6`. If unset, the server queries `/v1/models` and auto-picks a tool-calling-capable model, logging its choice |
| `BRAVE_API_KEY` | Optional. Brave Search key — powers the grounding pre-stage web sweep and the agent's `searchWeb` tool. Without it, grounding is Wikipedia-only |
| `PORT` | Optional. Server port, default `3017` |

## The two-stage agent

Every run is **grounding first, images second**:

1. **Stage 1 — map the territory** (always runs, server-driven): Wikipedia + Brave fan out on the raw query in parallel; a dedicated model pass distills the materials into a **topic map** — entities with formal name forms, timeline anchors, adjacent figures, precise collection-search terms (with known collisions flagged, e.g. Off-White the label vs off-white the color), and candidate narrative axes. Persisted on the curation.
2. **Stage 2 — curate**: the curator loop works *from the map* — searching collections with its terms, following up via `researchWeb`/`searchWeb`, then hanging the show along an axis the map suggested, discarding false matches.

The **`log` button** in the canvas top bar opens the audit trail: grounding materials, the topic map, every thought, every tool call, and the exact result JSON the model reasoned over — streamed live and persisted inside the curation for post-hoc review.

Secrets live in `.env` (gitignored). `GET /api/health` reports whether inference is configured and which model resolved.

## How it works

```
browser ──POST /api/agent {q}──▶ Express ──▶ agent loop (Neuralwatt, streaming)
   ◀── SSE: session/thought/status/research/card/layout/done ──┘  │ tools
                                            ┌─────────────────────┤
                                            ├─ researchWeb(query)          → Wikipedia search + summaries
                                            ├─ searchCollections(q, srcs)  → Met · V&A · AIC · Cleveland
                                            └─ setLayout(axis, groups, synthesis, discard)
```

- **One agent, three tools.** `researchWeb` grounds the agent in real facts (timelines, names, movements — cited in the UI). `searchCollections` fans one query out across the chosen museums, iterable with refined terms or targeted sources (V&A for fashion, AIC/CMA for paintings, Met encyclopedic). `setLayout` is the final act: a **free-form axis**, labeled groups with one-line curatorial notes, an overall synthesis, and a `discard` list — broad searches inevitably catch off-topic works, and a curator doesn't hang them. Grouping logic lives server-side, never in the UI.
- **Stage, then animate.** Cards stream onto the canvas into a loose staging cluster the moment each record resolves (Met object fetches capped at 15 concurrent; V&A/AIC/CMA return render-ready records in one call). When `setLayout` arrives, cards animate from staging into labeled clusters; discarded cards leave the wall.
- **Re-grouping** (`group by: year / source / department / artist / medium`) posts to `/api/regroup`, which re-buckets the session's in-memory records — no re-fetch, no LLM call — and the same cards animate into the new arrangement. The agent's original axis stays available as a chip (✦).
- **Fallbacks:** sources fail independently (one museum's outage or rate-limit never blanks the show — adapters retry with backoff, and the agent is told to stop searching and hang what it has). If the model never emits a layout, the server groups by year so results never dangle in staging.
- **No database, no embeddings, no ingestion.** Live fetch, in-memory session state only.

## Layout of the code

```
server/
  index.js         Express: SSE endpoint, curations REST, regroup, health, serves dist/
  agent.js         the research-agent loop + the three tool implementations
  inference.js     Neuralwatt adapter (OpenAI-compatible client, model auto-pick)
  grouping.js      deterministic re-grouping for the manual axes
  curations.js     the persistence spine: JSON-file store, frozen record sets, snapshots
  research/
    wikipedia.js   Wikipedia search + page summaries (grounding, citations)
  sources/
    util.js        politeFetch (retry/backoff), parseYear, concurrency limiter
    index.js       source registry
    met.js         The Met (per-object fetch, image-rights probing)
    vam.js         V&A (render-ready search records; strong fashion/design)
    aic.js         Art Institute of Chicago (IIIF images)
    cma.js         Cleveland Museum of Art (open access)
scripts/
  seed.js          generates the pre-seeded exhibitions via the real agent pipeline
web/src/
  App.tsx           hash router (home / canvas) + theme toggle
  Home.tsx          homepage: search, recent curations, auto-scrolling preview wall
  CanvasView.tsx    canvas: agent flow, restore, autosave, title edit, group-by chips
  ArtCardShape.tsx  custom tldraw shape: image, title, date, "{Museum} — {dept}", ⓘ link
  canvas.ts         staging positions + animated/immediate group layout (labels, notes)
  api.ts            POST-SSE agent client + curations REST client
data/curations/     one JSON file per curation (gitignored; seeds regenerate via script)
```

### Adding a source later

Each adapter in `server/sources/` implements one interface — `search(query, { limit, onRecord }) → { total, records }` — mapping into the shared `NormalizedRecord` shape (`id: "<source>:<localId>", museum, title, objectDate, year, artist, department, medium, image, url, sourceLabel`). A future Europeana/Rijksmuseum/Smithsonian adapter is a new file plus one registry line in `sources/index.js`; the agent picks it up automatically via the tool schema.

## Notes & caveats

- Museum search endpoints are loose full-text (`"Yves Saint Laurent"` also matches medieval saints and Yves Tanguy); the agent reads fetched metadata, refines terms, targets sources, and discards what doesn't belong.
- Many Met objects pass `hasImages=true` with rights-restricted (non-public) images — common for 20th-century fashion; the Met adapter probes deeper into results until it fills its budget. The V&A is the fashion workhorse.
- Museum APIs intermittently 403/429 under burst load; `politeFetch` retries with backoff, and repeated failures tell the agent to stop searching and lay out what it has.
- `objectDate` is free text; the sortable year is the first 4-digit number found (deliberately dumb — "ca. 2300 BCE" lands in a "2300s" bucket and we accept that with dignity).
- Budgets: 12 records per source per search, 80 per curation.
- The event stream rides a **POST** fetch with a hand-parsed SSE body, not `EventSource`: Cloudflare quick tunnels buffer GET SSE responses until the stream closes but pass POST streams through in real time ([cloudflared#1449](https://github.com/cloudflare/cloudflared/issues/1449)) — kept this way so a future public iteration works through a tunnel unchanged. A `GET /api/agent?q=…` variant remains for curl debugging.
- `index.html` is served with `Cache-Control: no-cache` (hashed assets cache forever) so rebuilds never strand a client on a stale bundle.
- The "128+ sites" headline is aspirational copy per the spec; the adapter seam currently holds the four real sources above. None are faked.
