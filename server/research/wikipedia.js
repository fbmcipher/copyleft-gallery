// Wikipedia grounding for the research agent: search, then fetch summaries of
// the top pages. Returns citable context, not collection objects.
import { politeFetch } from '../sources/util.js';

const SEARCH = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary';

export async function researchWikipedia(query, { limit = 3 } = {}) {
  const search = await politeFetch(`${SEARCH}?q=${encodeURIComponent(query)}&limit=5`);
  const pages = (search?.pages ?? []).slice(0, limit);

  const results = await Promise.all(
    pages.map(async (p) => {
      const s = await politeFetch(`${SUMMARY}/${encodeURIComponent(p.key)}`, {
        retries: 2,
      }).catch(() => null);
      return {
        title: p.title,
        description: p.description || s?.description || '',
        summary: s?.extract || '',
        url:
          s?.content_urls?.desktop?.page ||
          `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
      };
    })
  );
  return results.filter((r) => r.summary || r.description);
}
