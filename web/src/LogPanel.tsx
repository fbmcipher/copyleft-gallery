import { useEffect, useRef } from 'react'
import type { LogEntry } from './types'

// The agent audit trail (v0.2 follow-up): thoughts, tool calls, and the exact
// result JSON the model reasons over — lightly formatted, nothing hidden.
// Two sizes: compact side rail, or expanded (full-width, details unfolded).

function ts(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resultSummary(name: string, result: any): string {
  if (result?.error) return `error: ${result.error}`
  if (name === 'searchSources' || name === 'searchCollections') {
    const per = Object.entries(result?.perSource ?? {})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(([k, v]: [string, any]) => (v.error ? `${k}: ✗ ${v.error}` : `${k}: ${v.matched} matched`))
      .join(' · ')
    return `${result?.fetchedNow ?? 0} fetched (${result?.totalFetchedSoFar ?? 0} total) — ${per}`
  }
  if (name === 'researchWeb') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const titles = (result?.results ?? []).map((r: any) => r.title).join(' · ')
    return `${result?.results?.length ?? 0} articles — ${titles}`
  }
  if (name === 'readPage') {
    return result?.text ? `${result.text.length} chars read — ${result.url ?? ''}` : ''
  }
  if (name === 'setLayout') {
    return `ok — ${result?.groupsRendered ?? 0} groups, ${result?.discarded ?? 0} discarded`
  }
  return ''
}

function Row({ entry, unfolded }: { entry: LogEntry; unfolded: boolean }) {
  const { type, data } = entry
  if (type === 'thought') {
    return (
      <div className="log-row log-thought">
        <span className="log-ts">{ts(entry.t)}</span>
        <div className="log-body">
          <em>{data.text}</em>
        </div>
      </div>
    )
  }
  if (type === 'tool_call') {
    return (
      <div className="log-row log-call">
        <span className="log-ts">{ts(entry.t)}</span>
        <div className="log-body">
          <span className="log-tag">→ {data.name}</span>
          <details {...(unfolded ? { open: true } : {})}>
            <summary>{JSON.stringify(data.args).slice(0, 110)}</summary>
            <pre>{JSON.stringify(data.args, null, 2)}</pre>
          </details>
        </div>
      </div>
    )
  }
  if (type === 'tool_result') {
    return (
      <div className="log-row log-result">
        <span className="log-ts">{ts(entry.t)}</span>
        <div className="log-body">
          <span className="log-tag">← {data.name}</span>
          <span className="log-summary">{resultSummary(data.name, data.result)}</span>
          <details {...(unfolded ? { open: true } : {})}>
            <summary>full result</summary>
            <pre>{JSON.stringify(data.result, null, 2)}</pre>
          </details>
        </div>
      </div>
    )
  }
  if (type === 'grounding') {
    const wikiN = data.wikipedia?.length ?? 0
    const webN = data.web?.length ?? 0
    return (
      <div className="log-row log-result">
        <span className="log-ts">{ts(entry.t)}</span>
        <div className="log-body">
          <span className="log-tag">◈ grounding</span>
          <span className="log-summary">
            wikipedia {wikiN} · web {data.braveConfigured ? webN : 'off (no BRAVE_API_KEY)'}
          </span>
          <details {...(unfolded ? { open: true } : {})}>
            <summary>materials</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </div>
      </div>
    )
  }
  if (type === 'deep_read') {
    return (
      <div className="log-row log-result">
        <span className="log-ts">{ts(entry.t)}</span>
        <div className="log-body">
          <span className="log-tag">◈ deep read</span>
          <span className="log-summary">
            {(data.read ?? []).length} sources read{data.failed ? ` · ${data.failed} failed` : ''}
          </span>
          <details {...(unfolded ? { open: true } : {})}>
            <summary>what was read</summary>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <pre>{(data.read ?? []).map((r: any) => `${r.label} (${r.chars} chars)`).join('\n')}</pre>
          </details>
        </div>
      </div>
    )
  }
  if (type === 'topic_map') {
    return (
      <div className="log-row log-map">
        <span className="log-ts">{ts(entry.t)}</span>
        <div className="log-body">
          <span className="log-tag">◈ exhibition plan</span>
          <pre className="log-map-text">{data.text}</pre>
        </div>
      </div>
    )
  }
  if (type === 'error') {
    return (
      <div className="log-row log-error">
        <span className="log-ts">{ts(entry.t)}</span>
        <div className="log-body">⚠ {data.message}</div>
      </div>
    )
  }
  return (
    <div className="log-row log-info">
      <span className="log-ts">{ts(entry.t)}</span>
      <div className="log-body">{data.message}</div>
    </div>
  )
}

export default function LogPanel({
  logs,
  live,
  expanded,
  onToggleExpanded,
  onClose,
}: {
  logs: LogEntry[]
  live: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // follow the tail while the run is live
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs.length, live])

  return (
    <div className={expanded ? 'log-panel expanded' : 'log-panel'}>
      <div className="log-head">
        <span className="log-head-title">agent log{live ? ' · live' : ''}</span>
        <button onClick={onToggleExpanded} title={expanded ? 'Contract' : 'Expand'}>
          {expanded ? 'contract ⤡' : 'expand ⤢'}
        </button>
        <button onClick={onClose} title="Close log">
          ×
        </button>
      </div>
      <div className="log-scroll" ref={ref}>
        {logs.length === 0 && (
          <div className="log-empty">
            no log for this curation — logs are recorded for runs made from now on
          </div>
        )}
        {logs.map((entry, i) => (
          <Row key={`${i}-${expanded}`} entry={entry} unfolded={expanded} />
        ))}
      </div>
    </div>
  )
}
