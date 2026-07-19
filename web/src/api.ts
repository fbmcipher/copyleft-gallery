import type { AgentHandlers, Curation, CurationMeta, Layout } from './types'

// The agent stream rides a POST fetch, not EventSource: Cloudflare quick
// tunnels buffer GET SSE responses until the stream closes, but POST streams
// in real time (cloudflare/cloudflared#1449). We parse SSE frames ourselves.

async function explainFailure(h: AgentHandlers) {
  try {
    const health = await (await fetch('/api/health')).json()
    if (!health.inferenceConfigured) {
      h.onError('The server has no Neuralwatt API key — set NEURALWATT_API_KEY in .env and restart.')
    } else if (health.modelError) {
      h.onError(`Neuralwatt is unreachable: ${health.modelError}`)
    } else {
      h.onError('Connection to the gallery agent was lost.')
    }
  } catch {
    h.onError('The gallery server is not running.')
  }
}

export function startAgent(query: string, h: AgentHandlers): () => void {
  const ctrl = new AbortController()

  const dispatch = (frame: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      // lines starting with ":" are heartbeats/comments — ignored
    }
    if (!dataLines.length) return false
    let data: any
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      return false
    }
    switch (event) {
      case 'session':
        h.onSession(data)
        break
      case 'thought':
        h.onThought(data.delta)
        break
      case 'status':
        h.onStatus(data.message)
        break
      case 'research':
        h.onResearch(data.results)
        break
      case 'card':
        h.onCard(data)
        break
      case 'layout':
        h.onLayout(data)
        break
      case 'log':
        h.onLog(data)
        break
      case 'error':
        h.onError(data.message)
        break
      case 'done':
        h.onDone()
        return true
    }
    return false
  }

  ;(async () => {
    let sawDone = false
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ q: query }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error(`agent request failed (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i)
          buf = buf.slice(i + 2)
          if (frame.trim() && dispatch(frame)) sawDone = true
        }
      }
      if (!sawDone && !ctrl.signal.aborted) h.onDone()
    } catch {
      if (!ctrl.signal.aborted) await explainFailure(h)
    }
  })()

  return () => ctrl.abort()
}

export async function regroup(curationId: string, axis: string): Promise<Layout> {
  const res = await fetch('/api/regroup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ curationId, axis }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? `regroup failed (${res.status})`)
  return res.json()
}

export async function getCurations(): Promise<CurationMeta[]> {
  const res = await fetch('/api/curations')
  if (!res.ok) throw new Error(`list failed (${res.status})`)
  return res.json()
}

export async function getCuration(id: string): Promise<Curation> {
  const res = await fetch(`/api/curations/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`curation not found (${res.status})`)
  return res.json()
}

// Layout-only pass for interrupted curations (records exist, no agent layout).
export async function finishCuration(id: string): Promise<Layout> {
  const res = await fetch(`/api/curations/${encodeURIComponent(id)}/finish`, { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).error ?? `finish failed (${res.status})`)
  return res.json()
}

export async function ask(
  curationId: string,
  question: string,
  objectId?: string
): Promise<{ answer: string; refs: { title: string; url: string }[] }> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ curationId, question, objectId }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? `ask failed (${res.status})`)
  return res.json()
}

export async function deleteCuration(id: string): Promise<void> {
  const res = await fetch(`/api/curations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (res.ok) return

  const body = await res.json().catch(() => null)
  throw new Error(body?.error ?? `delete failed (${res.status})`)
}

// Autosave — fire-and-forget; the canvas must never block on persistence.
export function patchCuration(
  id: string,
  patch: { title?: string; snapshot?: unknown; activeAxis?: string | null }
): Promise<void> {
  return fetch(`/api/curations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
    .then(() => undefined)
    .catch(() => undefined)
}
