// Met Museum Open Access adapter.
//
// Source interface (all adapters):
//   key, name
//   search(query, { limit, onRecord }) -> Promise<{ total, records }>
//     onRecord fires the moment each NormalizedRecord resolves (for streaming).
//
// NormalizedRecord:
//   { id: '<key>:<localId>', source, museum, title, objectDate, year,
//     artist, department, medium, image, url, sourceLabel }

import { politeFetch, parseYear, createLimiter } from './util.js';

const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
// The Met needs a per-object fetch, and many objects pass hasImages=true with
// rights-restricted (non-public) images — probe deeper than the limit, capped.
const MAX_PROBES = 60;
const limiter = createLimiter(15);

export const metSource = {
  key: 'met',
  name: 'The Met',

  async search(query, { limit = 12, onRecord } = {}) {
    const data = await politeFetch(
      `${BASE}/search?q=${encodeURIComponent(query)}&hasImages=true`
    );
    const ids = Array.isArray(data?.objectIDs) ? data.objectIDs : [];
    const candidates = ids.slice(0, MAX_PROBES);

    const records = [];
    const CHUNK = 15;
    for (let i = 0; i < candidates.length && records.length < limit; i += CHUNK) {
      await Promise.all(
        candidates.slice(i, i + CHUNK).map((id) =>
          limiter(async () => {
            if (records.length >= limit) return;
            const o = await politeFetch(`${BASE}/objects/${id}`, { retries: 2 }).catch(
              () => null
            );
            if (!o?.primaryImageSmall || records.length >= limit) return;
            const record = {
              id: `met:${o.objectID}`,
              source: 'met',
              museum: 'The Met',
              title: o.title || 'Untitled',
              objectDate: o.objectDate || '',
              year: parseYear(o.objectDate),
              artist: o.artistDisplayName || '',
              department: o.department || '',
              medium: o.medium || '',
              image: o.primaryImageSmall,
              url:
                o.objectURL || `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
              sourceLabel: `The Met — ${o.department || 'Collection'}`,
            };
            records.push(record);
            onRecord?.(record);
          })
        )
      );
    }
    return { total: ids.length, records };
  },
};
