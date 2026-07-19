// The research agent, planner-backbone edition.
//
// Stage 1 (planner): synthesize Wikipedia + web into an EXHIBITION PLAN —
// the story, the rooms, and per-room wanted-item lists with source routing.
// Stage 2 (curator): procure images for the plan from every available source
// (museums, Wikimedia Commons, the web), then hang the show.
//
//   researchWeb(query)              — Wikipedia follow-ups
//   searchWeb(query)                — Brave web follow-ups
//   searchSources(query, sources)   — image procurement across all sources
//   setLayout(axis, groups, …)      — final act; free-form axis, notes per group
//
// The agent owns grouping and synthesis. The frontend just draws what it's told.

import { streamChat, getModel } from './inference.js';
import { SOURCES, availableSourceKeys } from './sources/index.js';
import { researchWikipedia } from './research/wikipedia.js';
import { braveSearch, braveConfigured } from './research/brave.js';
import { readPage, wikipediaFullText } from './research/readPage.js';
import { groupRecords } from './grouping.js';

const PER_SOURCE_LIMIT = 12; // records per source per search call
const MAX_TOTAL = 90; // cards per session
const MAX_ROUNDS = 12;

const SOURCE_GUIDE = {
  met: 'The Met, New York — encyclopedic, historical',
  vam: 'V&A, London — strong in fashion/design',
  aic: 'Art Institute of Chicago — paintings, prints',
  cma: 'Cleveland Museum of Art — broad historical',
  commons: 'Wikimedia Commons — licensed photos of nearly everything notable, incl. contemporary culture, products, runway/exhibition photos',
  web: 'Brave image search — the open web; anything, any era; provenance is the source domain',
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'researchWeb',
      description:
        'Look up background on Wikipedia: designers, movements, periods, techniques, timelines. Use this for follow-up grounding beyond the pre-stage topic map. Returns article summaries with URLs you can cite in your synthesis.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Topic to research, e.g. "Yves Saint Laurent designer".' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchWeb',
      description:
        'General web search (Brave). Use when Wikipedia is thin: niche designers, specific collections/collaborations, which museums hold what, contemporary figures. Returns titles, URLs, and snippets. Follow up with readPage to actually read a promising result.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Web search query.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readPage',
      description:
        'Read the full text of a web page (article, interview, feature). Use this to get depth — quotes, dates, specifics — for wall labels and notes. Works on URLs from searchWeb results or the plan.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The page URL to read.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchSources',
      // description + enum are filled per-run from the available sources
      description: '',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search terms.' },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Subset of sources to search. Route deliberately: target the sources the plan says are likely to hold this item. Default: all available.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setLayout',
      description:
        'Your final act as curator: arrange every fetched object into labeled spatial groups. Choose whichever grouping axis is most meaningful for THIS query — period, maker, medium, technique, theme, movement, anything. Aim for 3–8 groups with exhibition-style labels; add a one-sentence note per group and an overall synthesis (2–4 sentences weaving in what you learned from research — cite facts, not URLs). Every fetched objectID must appear in exactly one group.',
      parameters: {
        type: 'object',
        properties: {
          axis: {
            type: 'string',
            description: 'Free-form name of the grouping axis, e.g. "decade", "design era", "medium".',
          },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                groupLabel: { type: 'string' },
                note: {
                  type: 'string',
                  description: 'One-sentence curatorial note for this group (optional).',
                },
                objectIDs: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs exactly as returned by searchSources, e.g. "vam:O1135550" or "web:ab12…".',
                },
              },
              required: ['groupLabel', 'objectIDs'],
            },
          },
          synthesis: {
            type: 'string',
            description: 'Short curatorial synthesis of the whole show (optional but encouraged).',
          },
          discard: {
            type: 'array',
            items: { type: 'string' },
            description:
              'objectIDs that do NOT belong in this exhibition (off-topic catches from broad searches). They are removed from the canvas. Every fetched ID must be either grouped or discarded.',
          },
          furtherReading: {
            type: 'array',
            items: { type: 'string' },
            description:
              '3-5 adjacent exhibitions worth mounting next — short evocative topic phrases a visitor could leap into ("Rem Koolhaas and OMA", "The Ten: Nike × Off-White", "Been Trill and the DJ collective era"). Drawn from the depth of your research, not the obvious.',
          },
          annotations: {
            type: 'array',
            description:
              'Author the wall labels. For every kept object — ESSENTIAL for web finds whose scraped titles are junk — provide a clean title, date if known, maker if known, and a one-sentence note grounding it in the story (a fact or short quote from your research).',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'objectID this label belongs to.' },
                title: { type: 'string', description: 'Clean exhibition title for the work.' },
                date: { type: 'string', description: 'Date/period if known, e.g. "2013" or "ca. 2017".' },
                artist: { type: 'string', description: 'Maker/designer if known.' },
                note: { type: 'string', description: 'One-sentence curatorial note (fact or quote).' },
              },
              required: ['id'],
            },
          },
        },
        required: ['axis', 'groups'],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the curator of a spatial research gallery. A visitor gives you a research query; a planner pre-stage has already synthesized the web's knowledge into an EXHIBITION PLAN (included in the first message): the story, the rooms, and per-room lists of wanted items with suggested sources. Your job is procurement and hanging: find images for the plan's rooms across ALL available sources, then arrange the show.

Workflow:
1. Think briefly (a sentence, visible to the visitor) about the show you're about to build.
2. Work the plan room by room: call searchSources with the plan's precise item terms, routed to the sources the plan suggests. Museums are authoritative for historical holdings; commons has licensed photos of contemporary culture; web reaches everything else. Museum full-text search is loose (color words, first names flood results) — read returned metadata skeptically against the plan. If a room stays empty after two attempts, note it and move on; if you discover something the plan missed, researchWeb/searchWeb/readPage can fill the gap — readPage an interview or feature when you need quotes or specifics the plan lacks.
3. When the rooms have material, call setLayout ONCE. Prefer groups that realize the plan's rooms (use its narrative axis unless the material argues otherwise). Labels read like wall text; each group gets a one-sentence note; the synthesis tells the plan's story through what you actually found, honestly noting gaps. Off-topic catches go in "discard" — every fetched objectID appears exactly once, grouped or discarded. A small, honest show beats a padded one.
4. End the show with "furtherReading": 3-5 adjacent exhibitions a curious visitor could leap into next, drawn from the depth of your research.
5. AUTHOR THE WALL LABELS: for every kept object, provide an entry in "annotations" — clean title, date and maker if known, and a one-sentence note tying it to the story (a concrete fact or a short verbatim quote from the plan or your reading). Web finds arrive with scraped junk titles ("Image 1 of 4 | eBay") — never leave those as-is. The visitor should learn something from every card they zoom into.

Keep visible commentary brief. Do not enumerate objects in prose; the canvas shows them.`;

// Stage 1: the planner. Synthesize the web's knowledge into an exhibition
// plan FIRST; images get procured to fill it — never the other way around.
const PLANNER_PROMPT = `You are the director of a spatial research gallery that can hang images from museum collections, Wikimedia Commons, and the open web. Below are raw materials about a visitor's query — including FULL ARTICLE TEXTS, not just summaries. Read them closely and synthesize an EXHIBITION PLAN the curator will execute. Terse labeled sections:

STORY — 2-3 sentences: the narrative this exhibition tells.
ENTITIES — key people/labels/institutions, with aliases and formal catalog name forms ("Surname, Forename"); flag term collisions (e.g. "Off-White" the label vs off-white the color). Include collaborators and scene figures the articles surface — the adjacent names are often the depth.
TIMELINE — the 4-8 anchor dates/periods that structure the topic.
QUOTES — 2-4 short verbatim quotes from the materials worth putting on the wall (speaker + where it's from). Only quote what actually appears in the materials.
ROOMS — 3-6 named rooms (these become the wall groups). For each: one line of intent, then 2-5 WANTED items/images (specific works, products, moments, documents) each with the best search string and suggested sources in brackets, e.g. "Markerad daybed prototype [web, commons]" / "Abloh, Virgil garments [vam]". Route deliberately: museums for canonical historical objects; commons for licensed photos of contemporary/product/event material; web for everything else. Draw wanted items from the DEPTH of the articles (specific collections, collaborations, moments), not just the obvious hits.
SOURCES AVAILABLE — {{SOURCES}}

Under 450 words. No preamble. If materials are thin, say so and plan conservatively around what is verifiable.`;

// Neuralwatt drops connections under load (ETIMEDOUT mid-stream). Retry
// transient failures; rethrow real ones (bad request, aborted run).
async function chatWithRetry(opts, logEntry, attempts = 3) {
  for (let i = 0; ; i++) {
    try {
      return await streamChat(opts);
    } catch (err) {
      const msg = String(err?.message ?? err);
      const transient = /timed?.?out|ETIMEDOUT|ECONNRESET|fetch failed|Connection error|air ?gap|502|503|504|429/i.test(msg);
      if (!transient || i >= attempts - 1 || opts.signal?.aborted) throw err;
      logEntry?.('info', {
        message: `model call failed (${msg.slice(0, 90)}) — retrying ${i + 1}/${attempts - 1}`,
      });
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

function compact(record) {
  return {
    id: record.id,
    title: record.title,
    date: record.objectDate,
    artist: record.artist,
    museum: record.museum,
    department: record.department,
    medium: record.medium,
  };
}

async function execSearchWeb(args, emit) {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query is required' };
  if (!braveConfigured()) {
    return { error: 'Web search is not configured on this server (BRAVE_API_KEY missing).' };
  }
  emit('status', { message: `Searching the web for “${query}”…` });
  try {
    const results = await braveSearch(query, { count: 8 });
    return { results };
  } catch (err) {
    return { error: `Web search failed: ${err.message}` };
  }
}

async function execResearchWeb(args, session, emit) {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query is required' };
  emit('status', { message: `Reading Wikipedia on “${query}”…` });
  try {
    const results = await researchWikipedia(query);
    const refs = results.map(({ title, url }) => ({ title, url }));
    for (const ref of refs) {
      if (!session.research.some((r) => r.url === ref.url)) session.research.push(ref);
    }
    emit('research', { query, results: refs });
    return { results };
  } catch (err) {
    return { error: `Wikipedia lookup failed: ${err.message}` };
  }
}

// Fan out one query across the chosen sources, streaming each card as it
// resolves. Sources fail independently — one outage never blanks the show.
async function execSearchSources(args, session, emit) {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query is required' };
  const avail = availableSourceKeys();
  const keys = (Array.isArray(args.sources) && args.sources.length
    ? args.sources.filter((s) => avail.includes(s))
    : avail);
  if (!keys.length) return { error: `no valid sources; available: ${avail.join(', ')}` };

  session.searchCache ??= new Map();
  const cacheKey = `${keys.join(',')}|${query}`;
  if (session.searchCache.has(cacheKey)) return session.searchCache.get(cacheKey);

  emit('status', {
    message: `Searching ${keys.map((k) => SOURCES[k].name).join(', ')} for “${query}”…`,
  });

  const fetched = [];
  const onRecord = (record) => {
    if (session.records.size >= MAX_TOTAL || session.records.has(record.id)) return;
    session.records.set(record.id, record);
    fetched.push(compact(record));
    emit('card', record); // stream into staging immediately
  };

  const perSource = {};
  await Promise.all(
    keys.map(async (key) => {
      try {
        const { total } = await SOURCES[key].search(query, {
          limit: Math.min(PER_SOURCE_LIMIT, Math.max(0, MAX_TOTAL - session.records.size)),
          onRecord,
        });
        perSource[key] = { matched: total };
      } catch (err) {
        perSource[key] = { error: `${SOURCES[key].name} ${err.message}` };
      }
    })
  );

  const result = {
    query,
    perSource,
    fetchedNow: fetched.length,
    totalFetchedSoFar: session.records.size,
    objects: fetched,
    note:
      session.records.size >= MAX_TOTAL
        ? 'Object budget reached; stop searching and call setLayout.'
        : undefined,
  };
  session.searchCache.set(cacheKey, result);
  return result;
}

async function execReadPage(args, emit) {
  const url = String(args.url ?? '').trim();
  if (!url) return { error: 'url is required' };
  emit('status', { message: `Reading ${url.replace(/^https?:\/\//, '').slice(0, 60)}…` });
  try {
    if (/^https?:\/\/en\.wikipedia\.org\/wiki\//.test(url)) {
      const title = decodeURIComponent(url.split('/wiki/')[1] || '');
      return { url, text: await wikipediaFullText(title) };
    }
    return { url, text: await readPage(url) };
  } catch (err) {
    return { error: `could not read page: ${err.message}` };
  }
}

// Validate the model's layout against what was actually fetched.
function execSetLayout(args, session, emit) {
  const axis = String(args.axis ?? 'grouping');

  // Authored wall labels: apply to the frozen records so restores, regroups,
  // and the homepage all carry curated metadata instead of scraped junk.
  const annotations = [];
  for (const a of Array.isArray(args.annotations) ? args.annotations : []) {
    const record = session.records.get(String(a.id));
    if (!record) continue;
    if (a.title) record.title = String(a.title).slice(0, 160);
    if (a.artist) record.artist = String(a.artist).slice(0, 120);
    if (a.date) {
      record.objectDate = String(a.date).slice(0, 60);
      const y = record.objectDate.match(/\d{4}/);
      record.year = y ? Number(y[0]) : record.year;
    }
    if (a.note) record.annotation = String(a.note).slice(0, 400);
    annotations.push({
      id: record.id,
      title: record.title,
      date: record.objectDate,
      artist: record.artist,
      note: record.annotation,
    });
  }

  // Curatorial rejection: off-topic catches are removed from the session
  // entirely, so manual regroups stay consistent with the show.
  let discarded = 0;
  for (const id of Array.isArray(args.discard) ? args.discard : []) {
    if (session.records.delete(String(id))) discarded++;
  }

  const known = new Set(session.records.keys());
  const seen = new Set();
  const groups = [];

  for (const g of Array.isArray(args.groups) ? args.groups : []) {
    const objectIDs = (Array.isArray(g.objectIDs) ? g.objectIDs : [])
      .map(String)
      .filter((id) => known.has(id) && !seen.has(id));
    objectIDs.forEach((id) => seen.add(id));
    if (!objectIDs.length) continue;
    // models sometimes hang their rejects as a visible "Discards" room —
    // treat that as the discard list it was meant to be
    if (/^\s*(discard|rejected|off.topic)/i.test(String(g.groupLabel ?? ''))) {
      for (const id of objectIDs) {
        if (session.records.delete(id)) discarded++;
      }
      continue;
    }
    groups.push({
      groupLabel: String(g.groupLabel ?? '—'),
      note: g.note ? String(g.note) : undefined,
      objectIDs,
    });
  }

  const leftovers = [...known].filter((id) => !seen.has(id));
  if (leftovers.length) groups.push({ groupLabel: 'Ungrouped', objectIDs: leftovers });

  if (!groups.length) return { layout: null, result: { error: 'No valid objectIDs in groups.' } };

  const layout = {
    axis,
    groups,
    synthesis: args.synthesis ? String(args.synthesis) : undefined,
    annotations: annotations.length ? annotations : undefined,
    furtherReading: Array.isArray(args.furtherReading)
      ? args.furtherReading.map(String).filter(Boolean).slice(0, 5)
      : undefined,
    source: 'agent',
  };
  session.agentLayout = layout;
  session.synthesis = layout.synthesis ?? '';
  session.activeAxis = layout.axis;
  emit('layout', layout);
  return { layout, result: { ok: true, groupsRendered: groups.length, discarded } };
}

// Self-heal for interrupted runs (killed SSE, server restart, model error):
// the records and plan survived — run ONLY the hanging stage over them.
const FINISH_PROMPT = `You are the curator of a spatial research gallery. A run was interrupted after image procurement: the exhibition plan and every fetched object are below, but the show was never hung. Hang it NOW with a single setLayout call. Follow the plan's rooms where the material supports them; discard off-topic catches aggressively (broad searches caught junk — wrong artists, unrelated subjects); author annotations (clean title, date, maker, one-sentence note) for every kept object, especially web finds with scraped junk titles; write the synthesis honestly, noting gaps; include furtherReading. A small, honest show beats a padded one.`;

export async function finishCuration({ curation }) {
  const records = [...curation.records.values()].map(compact);
  if (!records.length) throw new Error('no records to hang');
  const setLayoutTool = TOOLS.find((t) => t.function.name === 'setLayout');
  const messages = [
    { role: 'system', content: FINISH_PROMPT },
    {
      role: 'user',
      content: `Query: "${curation.query}"\n\nEXHIBITION PLAN:\n${(curation.topicMap || '(plan unavailable — infer rooms from the objects)').slice(0, 4000)}\n\nFETCHED OBJECTS (${records.length}):\n${JSON.stringify(records)}\n\nCall setLayout now.`,
    },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const { toolCalls } = await chatWithRetry({ messages, tools: [setLayoutTool] }, null);
    const call = toolCalls.find((c) => c.function.name === 'setLayout');
    if (!call) {
      messages.push({ role: 'user', content: 'You must call the setLayout tool. Call it now.' });
      continue;
    }
    let args;
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      messages.push({ role: 'user', content: 'Your tool arguments were invalid JSON. Call setLayout again.' });
      continue;
    }
    const out = execSetLayout(args, curation, () => {});
    if (out.layout) return out.layout;
    messages.push({ role: 'user', content: `Layout invalid: ${out.result.error}. Call setLayout again with valid objectIDs.` });
  }
  throw new Error('model did not produce a valid layout');
}

export async function runAgent({ session, emit, signal }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: session.query },
  ];

  // The audit trail (spec discussion 2026-07-18): everything the agent thinks,
  // every tool call it issues, and the exact result JSON it reasons over.
  // Streamed live as SSE `log` events and persisted inside the curation.
  const t0 = Date.now();
  session.logs = [];
  const logEntry = (type, data) => {
    const entry = { t: Date.now() - t0, type, data };
    session.logs.push(entry);
    emit('log', entry);
  };

  const model = await getModel().catch(() => 'unknown');
  logEntry('info', { message: `run started — model ${model}`, query: session.query });

  // ---- STAGE 1: grounding pre-stage (always runs, server-driven) ----
  // Map the topic's surface area BEFORE any image search, so stage 2 curates
  // a narrative instead of hanging whatever the APIs return that day.
  emit('status', { message: 'Mapping the territory — reading Wikipedia and the web…' });
  const [wikiRes, webRes] = await Promise.allSettled([
    researchWikipedia(session.query, { limit: 4 }),
    braveConfigured() ? braveSearch(session.query, { count: 8 }) : Promise.reject(new Error('not configured')),
  ]);
  const wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : [];
  const web = webRes.status === 'fulfilled' ? webRes.value : [];
  logEntry('grounding', {
    wikipedia: wiki.map(({ title, description, url }) => ({ title, description, url })),
    web: web.map(({ title, url, description }) => ({ title, url, description })),
    braveConfigured: braveConfigured(),
    ...(webRes.status === 'rejected' && braveConfigured()
      ? { webError: webRes.reason?.message }
      : {}),
  });

  // surface citations in the UI
  for (const ref of [...wiki, ...web.slice(0, 3)]) {
    if (ref.url && !session.research.some((r) => r.url === ref.url)) {
      session.research.push({ title: ref.title, url: ref.url });
    }
  }
  if (session.research.length) {
    emit('research', { query: session.query, results: session.research });
  }

  // Deep read: the summaries above locate the topic; the articles hold the
  // depth. Read the top Wikipedia articles in full and the top web pages.
  emit('status', { message: 'Reading the sources in depth…' });
  const wikiTargets = wiki.slice(0, 2);
  const webTargets = web.slice(0, 3);
  const reads = await Promise.allSettled([
    ...wikiTargets.map((w) =>
      wikipediaFullText(w.title, { maxChars: 16000 }).then((text) => ({
        label: `WIKIPEDIA ARTICLE: ${w.title}`,
        text,
      }))
    ),
    ...webTargets.map((w) =>
      readPage(w.url, { maxChars: 6000 }).then((text) => ({ label: `PAGE: ${w.title} [${w.url}]`, text }))
    ),
  ]);
  const extracts = reads.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  logEntry('deep_read', {
    read: extracts.map((e) => ({ label: e.label.slice(0, 120), chars: e.text.length })),
    failed: reads.filter((r) => r.status === 'rejected').length,
  });

  const materials = [
    'WIKIPEDIA (summaries):',
    ...wiki.map((r) => `- ${r.title} (${r.description || 'article'}): ${r.summary.slice(0, 400)}`),
    '',
    web.length ? 'WEB SEARCH (Brave):' : 'WEB SEARCH: unavailable',
    ...web.map((r) => `- ${r.title} — ${r.description.slice(0, 200)} [${r.url}]`),
    '',
    ...extracts.map((e) => `=== ${e.label} ===\n${e.text}`),
  ]
    .join('\n')
    .slice(0, 56000);

  const avail = availableSourceKeys();
  const sourceGuideText = avail.map((k) => `${k} (${SOURCE_GUIDE[k] ?? SOURCES[k].name})`).join('; ');

  let plan = '';
  if (wiki.length || web.length) {
    emit('status', { message: 'Drafting the exhibition plan…' });
    try {
      const planned = await chatWithRetry({
        messages: [
          { role: 'system', content: PLANNER_PROMPT.replace('{{SOURCES}}', sourceGuideText) },
          { role: 'user', content: `Query: "${session.query}"\n\n${materials}` },
        ],
        // text-only pass — a fast variant keeps time-to-first-card low
        model: process.env.NEURALWATT_PLANNER_MODEL || undefined,
        signal,
      });
      plan = (planned.content || '').trim();
    } catch (err) {
      logEntry('error', { message: `planner pass failed: ${err.message}` });
    }
  } else {
    logEntry('info', { message: 'no grounding materials found — skipping plan' });
  }
  if (plan) logEntry('topic_map', { text: plan });
  session.topicMap = plan;

  // ---- STAGE 2: the curator loop (procure the plan, hang the show) ----
  const userContent = plan
    ? `Query: "${session.query}"\n\nEXHIBITION PLAN (from the planner pre-stage):\n${plan}\n\nProcure and hang the show.`
    : wiki.length || web.length
      ? `Query: "${session.query}"\n\nRAW GROUNDING MATERIALS (planner pass unavailable — work from these directly):\n${materials.slice(0, 4000)}\n\nCurate the show.`
      : `Query: "${session.query}"\n\n(The pre-stage found no grounding materials — proceed carefully, search conservatively, and discard aggressively.)`;
  messages.length = 0;
  messages.push({ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent });

  let layoutSet = false;
  const tools = (braveConfigured() ? TOOLS : TOOLS.filter((t) => t.function.name !== 'searchWeb')).map(
    (t) => {
      if (t.function.name !== 'searchSources') return t;
      // fill the per-run source roster into schema + description
      return {
        type: 'function',
        function: {
          ...t.function,
          description: `Search for images across the gallery's sources (results stream to the canvas; returns metadata for what was fetched). Available sources: ${sourceGuideText}. Full-text search is loose everywhere — verify returned titles/makers against the plan. Museums use formal catalog names ("Saint-Laurent, Yves").`,
          parameters: {
            ...t.function.parameters,
            properties: {
              ...t.function.parameters.properties,
              sources: {
                ...t.function.parameters.properties.sources,
                items: { type: 'string', enum: avail },
              },
            },
          },
        },
      };
    }
  );

  for (let round = 0; round < MAX_ROUNDS && !layoutSet; round++) {
    const { content, toolCalls } = await chatWithRetry(
      {
        messages,
        tools,
        signal,
        onText: (delta) => emit('thought', { delta }),
      },
      logEntry
    );

    if (content) logEntry('thought', { round, text: content });

    if (!toolCalls.length) {
      logEntry('info', { round, message: 'model stopped without calling a tool' });
      if (content) emit('status', { message: content });
      break;
    }

    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        logEntry('error', {
          round,
          message: `tool ${call.function.name}: arguments were not valid JSON`,
          raw: (call.function.arguments || '').slice(0, 400),
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: 'Arguments were not valid JSON. Try again.' }),
        });
        continue;
      }

      logEntry('tool_call', { round, name: call.function.name, args });

      let result;
      if (call.function.name === 'searchSources' || call.function.name === 'searchCollections') {
        result = await execSearchSources(args, session, emit);
      } else if (call.function.name === 'researchWeb') {
        result = await execResearchWeb(args, session, emit);
      } else if (call.function.name === 'searchWeb') {
        result = await execSearchWeb(args, emit);
      } else if (call.function.name === 'readPage') {
        result = await execReadPage(args, emit);
      } else if (call.function.name === 'setLayout') {
        const out = execSetLayout(args, session, emit);
        result = out.result;
        if (out.layout) layoutSet = true;
      } else {
        result = { error: `Unknown tool ${call.function.name}` };
      }

      // Exactly what goes back into the model's context — the evidence base
      // for its next decision.
      logEntry('tool_result', { round, name: call.function.name, result });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Never leave the visitor staring at an unarranged staging pile: if the
  // agent didn't produce a layout but we do have objects, group by year.
  if (!layoutSet && session.records.size > 0) {
    const fallback = { ...groupRecords([...session.records.values()], 'year'), source: 'fallback' };
    session.agentLayout = fallback;
    session.activeAxis = fallback.axis;
    logEntry('info', { message: 'agent produced no layout — server fell back to grouping by year' });
    emit('status', { message: 'Curator went quiet — arranging by year instead.' });
    emit('layout', fallback);
  } else if (!layoutSet && session.records.size === 0) {
    logEntry('info', { message: 'run ended with zero records fetched' });
    emit('status', {
      message: 'Nothing with images matched that query in any collection. Try different terms.',
    });
  }
  logEntry('info', {
    message: `run finished — ${session.records.size} records, layout ${layoutSet ? 'by agent' : 'fallback/none'}`,
  });
}
