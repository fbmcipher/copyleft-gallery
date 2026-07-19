// Victoria & Albert Museum adapter — one search call returns render-ready
// summary records (no per-object fetch). Strong fashion/design holdings.
import { politeFetch, parseYear } from './util.js';

const BASE = 'https://api.vam.ac.uk/v2';

export const vamSource = {
  key: 'vam',
  name: 'V&A',

  async search(query, { limit = 12, onRecord } = {}) {
    const data = await politeFetch(
      `${BASE}/objects/search?q=${encodeURIComponent(query)}&images_exist=1&page_size=${Math.min(
        limit * 2,
        50
      )}`
    );
    const records = [];
    for (const r of data?.records ?? []) {
      if (records.length >= limit) break;
      const imageId = r._primaryImageId;
      if (!imageId) continue;
      const record = {
        id: `vam:${r.systemNumber}`,
        source: 'vam',
        museum: 'V&A',
        title: r._primaryTitle || r.objectType || 'Untitled',
        objectDate: r._primaryDate || '',
        year: parseYear(r._primaryDate),
        artist: r._primaryMaker?.name || '',
        department: r.objectType || '',
        medium: '',
        image: `https://framemark.vam.ac.uk/collections/${imageId}/full/!400,400/0/default.jpg`,
        url: `https://collections.vam.ac.uk/item/${r.systemNumber}`,
        sourceLabel: `V&A — ${r.objectType || 'Collection'}`,
      };
      records.push(record);
      onRecord?.(record);
    }
    return { total: data?.info?.record_count ?? records.length, records };
  },
};
