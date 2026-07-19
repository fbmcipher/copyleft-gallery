// Shared helpers for Source adapters.

const FETCH_TIMEOUT_MS = 20_000;
const UA = 'copyleft-gallery/0.1 (spatial art research canvas demo)';

// Museum APIs intermittently 403/429 under burst load. Back off and retry
// rather than surfacing every transient refusal to the agent.
export async function politeFetch(url, { retries = 3, headers = {} } = {}) {
  let lastStatus = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    let res = null;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': UA, ...headers },
      });
    } catch {
      // timeout / network error — retry below
    }
    if (res?.ok) return res.json();
    if (res?.status === 404) return null;
    lastStatus = res?.status ?? 'network error';
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`refused (${lastStatus})`);
}

// Free-text dates ("ca. 1976", "1960s", "1962–66"): first 4-digit number is
// the sortable year. Dumb but sufficient.
export function parseYear(text) {
  const m = String(text ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

// Minimal promise-pool limiter (per-source fetch concurrency cap).
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < max && queue.length) {
      active++;
      const run = queue.shift();
      run();
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() =>
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          })
      );
      pump();
    });
}
