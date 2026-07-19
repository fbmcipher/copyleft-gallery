// Deep reading: fetch a URL and extract its readable text. The research layer
// must READ, not skim — depth on the wall starts here.
import { politeFetch } from '../sources/util.js';

const UA = 'copyleft-gallery/0.2 (spatial art research canvas)';
const TIMEOUT_MS = 15_000;

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;|&#8217;/g, '’')
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ');
}

// Crude readability: prefer <article>/<main>, strip chrome, collapse whitespace.
export async function readPage(url, { maxChars = 8000 } = {}) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('only http(s) pages');

  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain' },
  });
  if (!res.ok) throw new Error(`page refused (${res.status})`);
  const ct = res.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|xhtml/.test(ct)) throw new Error(`not a readable page (${ct})`);

  const html = (await res.text()).slice(0, 1_500_000);
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1] : null;
  };
  let scope =
    pick(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    pick(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    pick(/<body[^>]*>([\s\S]*?)<\/body>/i) ||
    html;

  scope = scope
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<(p|div|br|li|h[1-6]|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(scope)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2)
    .join('\n')
    .slice(0, maxChars);

  if (text.length < 200) throw new Error('page yielded no readable text');
  return text;
}

// Full plain-text extract of a Wikipedia article (the summaries are ~600
// chars; the articles hold the actual depth).
export async function wikipediaFullText(titleKey, { maxChars = 7000 } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'extracts',
    explaintext: '1',
    titles: titleKey.replace(/_/g, ' '),
    redirects: '1',
  });
  const data = await politeFetch(`https://en.wikipedia.org/w/api.php?${params}`);
  const page = Object.values(data?.query?.pages ?? {})[0];
  const text = page?.extract ?? '';
  if (!text) throw new Error('no extract');
  return text.slice(0, maxChars);
}
