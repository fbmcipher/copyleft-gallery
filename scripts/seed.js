// Pre-seeded exhibitions (spec v0.2 §4): run the real curator pipeline once
// per theme and freeze the result as a seeded curation. These power the
// homepage preview wall and the "leap into an exhibition" path. They are
// shared instances — later edits by anyone stick. Graffiti, yo.
//
// Usage: node scripts/seed.js [--force]

import '../server/env.js';
import { runAgent } from '../server/agent.js';
import { createCuration, getCuration, saveCuration } from '../server/curations.js';

const THEMES = [
  {
    id: 'expressionist-painting',
    title: 'A History of Expressionist Painting',
    query: 'history of expressionist painting — German and Austrian expressionism, Die Brücke, Der Blaue Reiter',
  },
  {
    id: 'impressionist-eye',
    title: 'The Impressionist Eye',
    query: 'impressionist landscape and city painting — Monet, Pissarro, Sisley and their circle',
  },
  {
    id: 'floating-world',
    title: 'Pictures of the Floating World',
    query: 'ukiyo-e japanese woodblock prints — Hokusai, Hiroshige, Utamaro',
  },
  {
    id: 'century-of-couture',
    title: 'A Century of Couture',
    query: 'a century of haute couture and fashion design — iconic garments 1900s to 1990s',
  },
  {
    id: 'medieval-gold',
    title: 'Gods and Gold: The Medieval Object',
    query: 'medieval devotional objects — reliquaries, gold, enamel, illuminated treasures',
  },
];

const force = process.argv.includes('--force');

for (const theme of THEMES) {
  const existing = await getCuration(theme.id);
  if (existing && !force) {
    console.log(`✓ ${theme.id} already seeded (${existing.records.size} works) — skipping`);
    continue;
  }
  console.log(`\n▸ Seeding "${theme.title}"…`);
  const curation = createCuration({
    id: theme.id,
    title: theme.title,
    query: theme.query,
    seeded: true,
  });
  const emit = (event, data) => {
    if (event === 'status') console.log(`   ${data.message}`);
    if (event === 'error') console.error(`   ⚠ ${data.message}`);
  };
  try {
    await runAgent({ session: curation, emit, signal: new AbortController().signal });
  } catch (err) {
    console.error(`   ⚠ agent failed: ${err.message}`);
  }
  if (curation.records.size === 0) {
    console.error(`   ✗ no works fetched for ${theme.id} — not saving`);
    continue;
  }
  curation.modifiedAt = Date.now();
  await saveCuration(curation);
  console.log(
    `   ✓ saved ${theme.id}: ${curation.records.size} works, ${curation.agentLayout?.groups.length ?? 0} groups (axis: ${curation.agentLayout?.axis ?? '—'})`
  );
}

console.log('\nDone.');
