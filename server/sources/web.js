// The web as a source (Brave Image Search). The gallery that has everything:
// museums are authoritative but sparse for contemporary topics; the web fills
// the plan's gaps. Cards carry the source domain as provenance and link out
// to the page the image lives on. Requires BRAVE_API_KEY (plan tier must
// include the images endpoint).
import { createHash } from 'node:crypto';
import { braveImageSearch, braveConfigured } from '../research/brave.js';
import { parseYear } from './util.js';

export const webSource = {
  key: 'web',
  name: 'Web',
  available: () => braveConfigured(),

  async search(query, { limit = 10, onRecord } = {}) {
    const results = await braveImageSearch(query, { count: Math.min(limit * 2, 30) });
    const records = [];
    for (const r of results) {
      if (records.length >= limit) break;
      if (!r.image || !r.pageUrl) continue;
      const id = `web:${createHash('sha1').update(r.pageUrl + r.image).digest('hex').slice(0, 16)}`;
      const record = {
        id,
        source: 'web',
        museum: 'Web',
        title: r.title || 'Untitled',
        objectDate: '',
        year: parseYear(r.title),
        artist: '',
        department: r.sourceDomain,
        medium: '',
        image: r.image,
        url: r.pageUrl,
        sourceLabel: `web — ${r.sourceDomain}`,
      };
      records.push(record);
      onRecord?.(record);
    }
    return { total: results.length, records };
  },
};
