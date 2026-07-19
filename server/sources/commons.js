// Wikimedia Commons — free, licensed images of nearly everything notable,
// including the contemporary culture legacy museums don't hold. Search the
// File namespace, pull image URLs + attribution from extmetadata.
import { politeFetch, parseYear } from './util.js';

const API = 'https://commons.wikimedia.org/w/api.php';

const strip = (html) => String(html ?? '').replace(/<[^>]+>/g, '').trim();

// Rapid-fire searches got 429-refused (visible in agent logs) — space them.
let queue = Promise.resolve();
let last = 0;
const SPACING_MS = 400;
function scheduled(fn) {
  const run = queue.then(async () => {
    const wait = last + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      last = Date.now();
    }
  });
  queue = run.catch(() => {});
  return run;
}

export const commonsSource = {
  key: 'commons',
  name: 'Wikimedia Commons',

  async search(query, { limit = 10, onRecord } = {}) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: '6',
      gsrlimit: String(Math.min(limit * 2, 40)),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '640',
    });
    const data = await scheduled(() => politeFetch(`${API}?${params}`));
    const pages = Object.values(data?.query?.pages ?? {}).sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0)
    );

    const records = [];
    for (const p of pages) {
      if (records.length >= limit) break;
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const meta = ii.extmetadata ?? {};
      const title = strip(meta.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.\w+$/, '');
      const date = strip(meta.DateTimeOriginal?.value).slice(0, 40);
      const license = strip(meta.LicenseShortName?.value);
      const record = {
        id: `commons:${p.pageid}`,
        source: 'commons',
        museum: 'Wikimedia Commons',
        title,
        objectDate: date,
        year: parseYear(date),
        artist: strip(meta.Artist?.value).slice(0, 80),
        department: license,
        medium: '',
        image: ii.thumburl,
        url: ii.descriptionurl || `https://commons.wikimedia.org/?curid=${p.pageid}`,
        sourceLabel: `Wikimedia Commons${license ? ` — ${license}` : ''}`,
      };
      records.push(record);
      onRecord?.(record);
    }
    return { total: pages.length, records };
  },
};
