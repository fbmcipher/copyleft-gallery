// Art Institute of Chicago adapter — search returns all needed fields; images
// via their IIIF endpoint.
import { politeFetch, parseYear } from './util.js';

const BASE = 'https://api.artic.edu/api/v1';
const FIELDS = 'id,title,date_display,artist_display,medium_display,image_id,department_title';

export const aicSource = {
  key: 'aic',
  name: 'Art Institute of Chicago',

  async search(query, { limit = 12, onRecord } = {}) {
    const data = await politeFetch(
      `${BASE}/artworks/search?q=${encodeURIComponent(query)}&limit=${Math.min(
        limit * 2,
        40
      )}&fields=${FIELDS}`
    );
    const records = [];
    for (const r of data?.data ?? []) {
      if (records.length >= limit) break;
      if (!r.image_id) continue;
      const record = {
        id: `aic:${r.id}`,
        source: 'aic',
        museum: 'Art Institute of Chicago',
        title: r.title || 'Untitled',
        objectDate: r.date_display || '',
        year: parseYear(r.date_display),
        artist: (r.artist_display || '').split('\n')[0],
        department: r.department_title || '',
        medium: r.medium_display || '',
        image: `https://www.artic.edu/iiif/2/${r.image_id}/full/400,/0/default.jpg`,
        url: `https://www.artic.edu/artworks/${r.id}`,
        sourceLabel: `Art Institute of Chicago — ${r.department_title || 'Collection'}`,
      };
      records.push(record);
      onRecord?.(record);
    }
    return { total: data?.pagination?.total ?? records.length, records };
  },
};
