// Ask Question / Ask About: answer a visitor's question in the context of a
// curation (optionally about one specific object). Grounded in the curation's
// plan + synthesis + records, plus a quick web sweep when configured.
import { streamChat } from './inference.js';
import { braveSearch, braveConfigured } from './research/brave.js';
import { researchWikipedia } from './research/wikipedia.js';

const ASK_PROMPT = `You are the resident curator of a spatial research gallery, answering a visitor's question during a walkthrough. Answer in 90-160 words, concrete and specific — dates, names, facts. Use the exhibition context and the fresh research below; if the materials don't support an answer, say what is and isn't known. No preamble, no headers — just the answer, as wall-text quality prose.`;

export async function askQuestion({ curation, question, record }) {
  // quick grounding sweep on the question itself
  const [wikiRes, webRes] = await Promise.allSettled([
    researchWikipedia(question, { limit: 2 }),
    braveConfigured()
      ? braveSearch(record ? `${record.title} ${question}` : question, { count: 5 })
      : Promise.reject(new Error('off')),
  ]);
  const wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : [];
  const web = webRes.status === 'fulfilled' ? webRes.value : [];

  const context = [
    `EXHIBITION: "${curation.title}" (query: ${curation.query})`,
    curation.topicMap ? `PLAN:\n${curation.topicMap.slice(0, 2500)}` : '',
    curation.synthesis ? `SYNTHESIS:\n${curation.synthesis.slice(0, 1200)}` : '',
    record
      ? `THE OBJECT IN QUESTION:\n${JSON.stringify(
          {
            title: record.title,
            artist: record.artist,
            date: record.objectDate,
            source: record.sourceLabel,
            note: record.annotation,
            url: record.url,
          },
          null,
          1
        )}`
      : '',
    wiki.length
      ? `WIKIPEDIA:\n${wiki.map((r) => `- ${r.title}: ${r.summary.slice(0, 500)}`).join('\n')}`
      : '',
    web.length
      ? `WEB:\n${web.map((r) => `- ${r.title} — ${r.description.slice(0, 200)}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { content } = await streamChat({
    messages: [
      { role: 'system', content: ASK_PROMPT },
      { role: 'user', content: `${context}\n\nVISITOR'S QUESTION: ${question}` },
    ],
    model: process.env.NEURALWATT_PLANNER_MODEL || undefined,
  });

  return {
    answer: (content || '').trim(),
    refs: [...wiki.map((r) => ({ title: r.title, url: r.url })), ...web.slice(0, 2).map((r) => ({ title: r.title, url: r.url }))],
  };
}
