// Cleveland Museum of Art adapter — open access, single search call.
import { politeFetch, parseYear } from './util.js';

const BASE = 'https://openaccess-api.clevelandart.org/api';

export const cmaSource = {
  key: 'cma',
  name: 'Cleveland Museum of Art',

  async search(query, { limit = 12, onRecord } = {}) {
    const data = await politeFetch(
      `${BASE}/artworks/?q=${encodeURIComponent(query)}&has_image=1&limit=${Math.min(
        limit * 2,
        40
      )}`
    );
    const records = [];
    for (const r of data?.data ?? []) {
      if (records.length >= limit) break;
      const image = r.images?.web?.url;
      if (!image) continue;
      const record = {
        id: `cma:${r.id}`,
        source: 'cma',
        museum: 'Cleveland Museum of Art',
        title: r.title || 'Untitled',
        objectDate: r.creation_date || '',
        year: r.creation_date_earliest ?? parseYear(r.creation_date),
        artist: r.creators?.[0]?.description || '',
        department: r.department || '',
        medium: r.technique || '',
        image,
        url: r.url || `https://www.clevelandart.org/art/${r.accession_number}`,
        sourceLabel: `Cleveland Museum of Art — ${r.department || 'Collection'}`,
      };
      records.push(record);
      onRecord?.(record);
    }
    return { total: data?.info?.total ?? records.length, records };
  },
};
