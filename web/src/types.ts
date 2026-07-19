// Shared shapes of the data flowing over SSE / JSON from the server.

export interface CardRecord {
  id: string // "<source>:<localId>", e.g. "vam:O1135550"
  source: string
  museum: string
  title: string
  objectDate: string
  year: number | null
  artist: string
  department: string
  medium: string
  image: string
  url: string
  sourceLabel: string
  annotation?: string
}

export interface LayoutGroup {
  groupLabel: string
  note?: string
  objectIDs: string[]
}

export interface CardAnnotation {
  id: string
  title?: string
  date?: string
  artist?: string
  note?: string
}

export interface Layout {
  axis: string
  groups: LayoutGroup[]
  synthesis?: string
  annotations?: CardAnnotation[]
  furtherReading?: string[]
  source?: 'agent' | 'manual' | 'fallback'
}

export interface ResearchRef {
  title: string
  url: string
}

// One line of the agent's audit trail. t = ms since run start.
export interface LogEntry {
  t: number
  type: 'info' | 'thought' | 'tool_call' | 'tool_result' | 'error' | 'grounding' | 'topic_map' | 'deep_read'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}

// Homepage list entry (meta only).
export interface CurationMeta {
  id: string
  title: string
  query: string
  seeded: boolean
  createdAt: number
  modifiedAt: number
  count: number
  covers: { image: string; title: string }[]
}

// Full curation: the frozen record set + the mutable canvas state.
export interface Curation {
  id: string
  title: string
  query: string
  seeded: boolean
  createdAt: number
  modifiedAt: number
  records: CardRecord[]
  agentLayout: Layout | null
  synthesis: string
  research: ResearchRef[]
  activeAxis: string | null
  snapshot: unknown | null
  logs: LogEntry[]
  topicMap: string
}

export interface AgentHandlers {
  onSession(data: { curationId: string; query: string }): void
  onThought(delta: string): void
  onStatus(message: string): void
  onResearch(refs: ResearchRef[]): void
  onCard(card: CardRecord): void
  onLayout(layout: Layout): void
  onLog(entry: LogEntry): void
  onError(message: string): void
  onDone(): void
}
