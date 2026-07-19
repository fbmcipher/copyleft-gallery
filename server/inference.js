// Inference adapter — all LLM calls go through here (§7).
//
// Neuralwatt exposes an OpenAI-compatible API (https://portal.neuralwatt.com/docs),
// so we use the official openai client pointed at the Neuralwatt base URL.
// Nothing outside this module knows which provider is behind it.

import OpenAI from 'openai';

const base = process.env.NEURALWATT_API_BASE || 'https://api.neuralwatt.com/v1';
const key = process.env.NEURALWATT_API_KEY || '';

let client = null;
let resolvedModel = process.env.NEURALWATT_MODEL || null;

export function inferenceConfigured() {
  return Boolean(key);
}

function getClient() {
  if (!key) {
    throw new Error(
      'NEURALWATT_API_KEY is not set. Put it in .env (see .env.example).'
    );
  }
  if (!client) client = new OpenAI({ baseURL: base, apiKey: key });
  return client;
}

// If NEURALWATT_MODEL isn't set, pick a tool-capable model from /v1/models.
// Preference order favors families known to handle function calling well.
const MODEL_PREFERENCE = [/kimi/i, /glm/i, /qwen/i, /minimax/i, /devstral/i];

export async function getModel() {
  if (resolvedModel) return resolvedModel;
  const { data } = await getClient().models.list();
  const ids = (data ?? []).map((m) => m.id);
  if (!ids.length) throw new Error('Neuralwatt /models returned no models.');
  for (const pref of MODEL_PREFERENCE) {
    const hit = ids.find((id) => pref.test(id));
    if (hit) {
      resolvedModel = hit;
      break;
    }
  }
  if (!resolvedModel) resolvedModel = ids[0];
  console.log(
    `[inference] NEURALWATT_MODEL not set — auto-selected "${resolvedModel}" from ${ids.length} available (${ids.join(', ')})`
  );
  return resolvedModel;
}

// Streaming chat completion with tool calling.
// Callbacks: onText(delta) for assistant prose, onUsage(usage) if provided.
// opts.model overrides the resolved default (e.g. a -fast variant for the planner).
// Returns { content, toolCalls, finishReason }.
export async function streamChat({ messages, tools, onText, signal, model: modelOverride }) {
  const model = modelOverride || (await getModel());
  const stream = await getClient().chat.completions.create(
    {
      model,
      messages,
      // tool_choice without tools is a validation error on Neuralwatt
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      stream: true,
    },
    { signal }
  );

  let content = '';
  let finishReason = null;
  const toolCalls = []; // accumulated by index

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (delta.content) {
      content += delta.content;
      onText?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? 0;
      toolCalls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) toolCalls[i].id = tc.id;
      if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
      if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  return { content, toolCalls: toolCalls.filter(Boolean), finishReason };
}
