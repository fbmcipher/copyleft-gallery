// Brave Search — the agent's web scout. Used in the grounding pre-stage and
// as a stage-2 tool. Degrades gracefully when no key is configured.
import { politeFetch } from '../sources/util.js';

const BASE = 'https://api.search.brave.com/res/v1/web/search';
const IMAGES = 'https://api.search.brave.com/res/v1/images/search';

export function braveConfigured() {
  return Boolean(process.env.BRAVE_API_KEY);
}

// Brave's plan allows ~1 request/second; parallel room searches were getting
// 422-refused (visible in the agent log). Serialize with spacing instead.
let braveQueue = Promise.resolve();
let lastCall = 0;
const MIN_SPACING_MS = 1100;

function scheduled(fn) {
  const run = braveQueue.then(async () => {
    const wait = lastCall + MIN_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastCall = Date.now();
    }
  });
  braveQueue = run.catch(() => {});
  return run;
}

// Image search — powers the `web` source adapter. Availability depends on the
// key's plan tier; callers treat failure as "source unavailable".
export async function braveImageSearch(query, { count = 12 } = {}) {
  if (!braveConfigured()) throw new Error('BRAVE_API_KEY not configured');
  const data = await scheduled(() => politeFetch(
    `${IMAGES}?q=${encodeURIComponent(query)}&count=${Math.min(count, 50)}&safesearch=strict`,
    {
      retries: 2,
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
    })
  );
  return (data?.results ?? []).map((r) => ({
    title: r.title || '',
    pageUrl: r.url || '',
    sourceDomain:
      r.source || r.meta_url?.hostname || (r.url ? new URL(r.url).hostname : ''),
    image: r.thumbnail?.src || r.properties?.url || '',
  }));
}

export async function braveSearch(query, { count = 8 } = {}) {
  if (!braveConfigured()) throw new Error('BRAVE_API_KEY not configured');
  const data = await scheduled(() => politeFetch(
    `${BASE}?q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}`,
    {
      retries: 2,
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
    })
  );
  return (data?.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    description: (r.description || '').replace(/<[^>]+>/g, ''),
    age: r.age,
  }));
}
