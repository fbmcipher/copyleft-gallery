import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, createShapeId, useValue, type Editor } from 'tldraw'
import { ArtCardShapeUtil } from './ArtCardShape'
import {
  TitlePanelShapeUtil,
  RoomHeaderShapeUtil,
  ReadingPanelShapeUtil,
  AnswerPanelShapeUtil,
  ANSWER_W,
} from './ExhibitShapes'
import {
  addCardToStaging,
  answerSpot,
  applyLayout,
  cardShapeId,
  materializeCuration,
  nextBandOrigin,
  zoomToContent,
} from './canvas'
import { ask, finishCuration, getCuration, patchCuration, regroup, startAgent } from './api'
import LogPanel from './LogPanel'
import type { Layout, LogEntry, ResearchRef } from './types'

const shapeUtils = [
  ArtCardShapeUtil,
  TitlePanelShapeUtil,
  RoomHeaderShapeUtil,
  ReadingPanelShapeUtil,
  AnswerPanelShapeUtil,
]
// our chrome lives bottom-left; hide tldraw's zoom widget there
const tldrawComponents = { NavigationPanel: null }

const MANUAL_AXES = ['year', 'source', 'department', 'artist', 'medium'] as const
const AUTOSAVE_MS = 1200

export type CanvasMode = { kind: 'new'; query: string } | { kind: 'restore'; id: string }

type Phase = 'idle' | 'loading' | 'running' | 'done'

interface CardOwner {
  recordId: string
  curationId: string
  title: string
}

export default function CanvasView({
  mode,
  theme,
  onToggleTheme,
  onHome,
}: {
  mode: CanvasMode
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onHome: () => void
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [title, setTitle] = useState(mode.kind === 'new' ? mode.query : '')
  const [narration, setNarration] = useState('')
  const [status, setStatus] = useState('')
  const [cardCount, setCardCount] = useState(0)
  const [activeAxis, setActiveAxis] = useState<string | null>(null)
  const [research, setResearch] = useState<ResearchRef[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [logExpanded, setLogExpanded] = useState(false)
  const [askText, setAskText] = useState('')
  const [asking, setAsking] = useState(false)
  const [diveBusy, setDiveBusy] = useState(false)
  const [needsFinish, setNeedsFinish] = useState(false)
  const [finishBusy, setFinishBusy] = useState(false)

  const curationIdRef = useRef<string | null>(mode.kind === 'restore' ? mode.id : null)
  const agentLayoutRef = useRef<Layout | null>(null)
  const activeAxisRef = useRef<string | null>(null)
  const countRef = useRef(0)
  const zoomTimerRef = useRef<number | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const suspendSaveRef = useRef(false)
  // which curation/record each card shape belongs to (deep dives add more)
  const ownersRef = useRef<Map<string, CardOwner>>(new Map())

  // tldraw follows our theme toggle, not the OS.
  useEffect(() => {
    editor?.user.updateUserPreferences({ colorScheme: theme })
    // dev hook for scripted testing/debugging
    ;(window as unknown as { __editor?: Editor | null }).__editor = editor
  }, [editor, theme])

  // ---- persistence: any document change → debounced snapshot save (§3) ----
  const scheduleSave = useCallback(() => {
    if (!editor || !curationIdRef.current || suspendSaveRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      const id = curationIdRef.current
      if (!id || !editor) return
      patchCuration(id, { snapshot: editor.getSnapshot(), activeAxis: activeAxisRef.current })
    }, AUTOSAVE_MS)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const unlisten = editor.store.listen(() => scheduleSave(), { scope: 'document' })
    return () => {
      unlisten()
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [editor, scheduleSave])

  const scheduleStagingZoom = useCallback((ed: Editor) => {
    if (zoomTimerRef.current) return
    zoomTimerRef.current = window.setTimeout(() => {
      zoomTimerRef.current = null
      zoomToContent(ed)
    }, 400)
  }, [])

  const titleRef = useRef(title)
  titleRef.current = title
  const researchRef = useRef<ResearchRef[]>([])

  const applyAndTrack = useCallback(
    (ed: Editor, layout: Layout, opts: { immediate?: boolean; pruneOrphans?: boolean } = {}) => {
      applyLayout(ed, layout, {
        ...opts,
        title: titleRef.current,
        refs: researchRef.current,
      })
      setActiveAxis(layout.axis)
      activeAxisRef.current = layout.axis
    },
    []
  )

  const rememberOwners = useCallback((records: { id: string; title: string }[], cur: string) => {
    for (const r of records) {
      ownersRef.current.set(cardShapeId(r.id), { recordId: r.id, curationId: cur, title: r.title })
    }
  }, [])

  // ---- entry: fresh query (agent flow) or faithful restore ----
  useEffect(() => {
    if (!editor) return

    if (mode.kind === 'new') {
      setPhase('running')
      stopRef.current = startAgent(mode.query, {
        onSession: ({ curationId }) => {
          curationIdRef.current = curationId
          // Adopt the canonical URL without remounting the view.
          history.replaceState(null, '', `#/c/${curationId}`)
        },
        onThought: (delta) => setNarration((prev) => (prev + delta).slice(-500)),
        onStatus: (message) => setStatus(message),
        onResearch: (refs) =>
          setResearch((prev) => {
            const seen = new Set(prev.map((r) => r.url))
            const next = [...prev, ...refs.filter((r) => !seen.has(r.url))]
            researchRef.current = next
            return next
          }),
        onLog: (entry) => setLogs((prev) => [...prev, entry]),
        onCard: (card) => {
          addCardToStaging(editor, card, countRef.current++)
          if (curationIdRef.current) rememberOwners([card], curationIdRef.current)
          setCardCount(countRef.current)
          scheduleStagingZoom(editor)
        },
        onLayout: (layout) => {
          if (layout.source !== 'manual') agentLayoutRef.current = layout
          applyAndTrack(editor, layout, { pruneOrphans: true })
          setCardCount(layout.groups.reduce((n, g) => n + g.objectIDs.length, 0))
        },
        onError: (message) => {
          setStatus(`⚠ ${message}`)
          setPhase('done')
        },
        onDone: () => {
          setPhase('done')
          setNarration('')
          setStatus('')
          scheduleSave()
        },
      })
      return () => stopRef.current?.()
    }

    // restore: the curation is a frozen-then-mutable set; never re-search.
    let cancelled = false
    setPhase('loading')
    ;(async () => {
      try {
        const curation = await getCuration(mode.id)
        if (cancelled) return
        setTitle(curation.title)
        setResearch(curation.research ?? [])
        researchRef.current = curation.research ?? []
        setLogs(curation.logs ?? [])
        agentLayoutRef.current = curation.agentLayout
        setCardCount(curation.records.length)
        rememberOwners(curation.records, curation.id)
        setNeedsFinish(!curation.agentLayout && curation.records.length > 0)

        let snapshotLoaded = false
        suspendSaveRef.current = true
        try {
          if (curation.snapshot) {
            try {
              // Exactly as the user left it: arrangement, deletions, annotations, camera.
              editor.loadSnapshot(curation.snapshot as never)
              snapshotLoaded = true
            } catch (snapErr) {
              // Snapshot from a mismatched app version (e.g. unknown shape type
              // in an outdated tab, or a schema we've since moved past): don't
              // die — rebuild the wall from the frozen records.
              console.warn('[restore] snapshot rejected — rebuilding from records', snapErr)
              editor.deleteShapes([...editor.getCurrentPageShapeIds()])
              materializeCuration(editor, curation.records, curation.agentLayout, {
                title: curation.title,
                refs: curation.research ?? [],
              })
              setStatus('snapshot was from another app version — rebuilt from records')
            }
          } else {
            // First open of a seeded exhibition — materialize, then autosave owns it.
            materializeCuration(editor, curation.records, curation.agentLayout, {
              title: curation.title,
              refs: curation.research ?? [],
            })
          }
        } finally {
          suspendSaveRef.current = false
        }

        const axis = curation.activeAxis ?? curation.agentLayout?.axis ?? null
        setActiveAxis(axis)
        activeAxisRef.current = axis
        setPhase('done')
        if (!snapshotLoaded) scheduleSave()
      } catch (err) {
        if (!cancelled) {
          setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`)
          setPhase('done')
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // ---- Continued Reading → nested deep-dive exhibitions ----
  useEffect(() => {
    if (!editor) return
    const onDive = (e: Event) => {
      const topic = (e as CustomEvent).detail?.topic
      if (!topic || diveBusy) return
      setDiveBusy(true)
      setStatus(`deep dive — ${topic}…`)
      const origin = nextBandOrigin(editor)
      const ns = `d${Date.now().toString(36)}`
      const scopeIds = new Set<string>()
      const diveRefs: ResearchRef[] = []
      let subCuration: string | null = null
      let count = 0
      startAgent(topic, {
        onSession: ({ curationId }) => {
          subCuration = curationId
        },
        onThought: () => {},
        onStatus: (message) => setStatus(`deep dive — ${message}`),
        onResearch: (refs) => diveRefs.push(...refs),
        onLog: (entry) => setLogs((prev) => [...prev, entry]),
        onCard: (card) => {
          addCardToStaging(editor, card, count++, origin)
          scopeIds.add(cardShapeId(card.id))
          if (subCuration) rememberOwners([card], subCuration)
        },
        onLayout: (layout) => {
          applyLayout(editor, layout, {
            pruneOrphans: true,
            scopeIds,
            ns,
            origin,
            title: topic,
            refs: diveRefs.slice(0, 6),
          })
        },
        onError: (message) => {
          setStatus(`⚠ ${message}`)
          setDiveBusy(false)
        },
        onDone: () => {
          setDiveBusy(false)
          setStatus('')
          scheduleSave()
        },
      })
    }
    window.addEventListener('clg:deepdive', onDive)
    return () => window.removeEventListener('clg:deepdive', onDive)
  }, [editor, diveBusy, rememberOwners, scheduleSave])

  // ---- Ask Question / Ask About ----
  const selected = useValue(
    'selected-card',
    () => {
      if (!editor) return null
      const shape = editor.getOnlySelectedShape()
      if (!shape || shape.type !== 'artcard') return null
      const owner = ownersRef.current.get(shape.id)
      const propsTitle = (shape.props as { title?: string }).title ?? ''
      return {
        shapeId: shape.id,
        x: shape.x,
        title: owner?.title || propsTitle,
        recordId: owner?.recordId,
        curationId: owner?.curationId,
      }
    },
    [editor]
  )

  const submitAsk = useCallback(async () => {
    const question = askText.trim()
    if (!editor || !question || asking) return
    const target = selected?.curationId ?? curationIdRef.current
    if (!target) return
    setAsking(true)
    const spot = answerSpot(editor, selected ? selected.x : 0)
    const panelId = createShapeId(`answer-${Date.now().toString(36)}`)
    editor.createShape({
      id: panelId,
      type: 'answerpanel',
      x: spot.x,
      y: spot.y,
      props: {
        w: ANSWER_W,
        h: 260,
        question,
        answer: '',
        about: selected?.title ?? '',
      },
    })
    editor.centerOnPoint(
      { x: spot.x + ANSWER_W / 2, y: spot.y + 140 },
      { animation: { duration: 500 } }
    )
    setAskText('')
    try {
      const res = await ask(target, question, selected?.recordId)
      editor.updateShapes([
        {
          id: panelId,
          type: 'answerpanel',
          props: {
            answer: res.answer,
            h: Math.min(680, 150 + Math.ceil(res.answer.length / 55) * 26),
          },
        },
      ])
    } catch (err) {
      editor.updateShapes([
        {
          id: panelId,
          type: 'answerpanel',
          props: { answer: `⚠ ${err instanceof Error ? err.message : String(err)}` },
        },
      ])
    } finally {
      setAsking(false)
    }
  }, [editor, askText, asking, selected])

  const handleFinish = useCallback(async () => {
    if (!editor || !curationIdRef.current || finishBusy) return
    setFinishBusy(true)
    setStatus('finishing the curation — hanging the show…')
    try {
      const layout = await finishCuration(curationIdRef.current)
      agentLayoutRef.current = layout
      const scopeIds = new Set(
        [...ownersRef.current.entries()]
          .filter(([, o]) => o.curationId === curationIdRef.current)
          .map(([sid]) => sid)
      )
      applyLayout(editor, layout, {
        pruneOrphans: true,
        scopeIds,
        title: titleRef.current,
        refs: researchRef.current,
      })
      setActiveAxis(layout.axis)
      activeAxisRef.current = layout.axis
      setNeedsFinish(false)
      setStatus('')
    } catch (err) {
      setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setFinishBusy(false)
    }
  }, [editor, finishBusy])

  const handleRegroup = useCallback(
    async (axis: string) => {
      if (!editor || !curationIdRef.current) return
      if (axis === agentLayoutRef.current?.axis) {
        applyAndTrack(editor, agentLayoutRef.current, { pruneOrphans: false })
        return
      }
      try {
        const layout = await regroup(curationIdRef.current, axis)
        applyAndTrack(editor, layout, { pruneOrphans: false })
      } catch (err) {
        setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [editor, applyAndTrack]
  )

  const commitTitle = useCallback(() => {
    if (curationIdRef.current && title.trim()) {
      patchCuration(curationIdRef.current, { title: title.trim() })
    }
  }, [title])

  const agentAxis = agentLayoutRef.current?.axis ?? null
  const showControls = phase === 'done' && cardCount > 0
  const busy = phase === 'running' || phase === 'loading' || diveBusy

  return (
    <div className="app">
      <div className="canvas">
        <Tldraw shapeUtils={shapeUtils} components={tldrawComponents} onMount={setEditor} />
      </div>

      <div className="canvas-chrome">
        {(busy || status) && (
          <div className="chrome-status">
            {phase === 'loading' && <span>opening…</span>}
            {phase === 'running' && <span className="pulse">curating…</span>}
            {diveBusy && <span className="pulse">deep diving…</span>}
            {narration && <em>{narration}</em>}
            {status && <span>{status}</span>}
            {phase === 'running' && cardCount > 0 && <span>{cardCount} works</span>}
          </div>
        )}

        {needsFinish && (
          <button className="finish-btn" onClick={handleFinish} disabled={finishBusy}>
            {finishBusy ? 'hanging the show…' : 'finish curating ✦ — this run was interrupted'}
          </button>
        )}

        {showControls && (
          <form
            className="askrow"
            onSubmit={(e) => {
              e.preventDefault()
              submitAsk()
            }}
          >
            {selected && (
              <span className="ask-about" title={selected.title}>
                “{selected.title.length > 26 ? selected.title.slice(0, 25) + '…' : selected.title}”
              </span>
            )}
            <input
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              placeholder={selected ? 'ask about this work…' : 'ask about this exhibition…'}
              aria-label="Ask a question"
            />
            <button type="submit" disabled={asking || !askText.trim()}>
              {asking ? '…' : 'ask'}
            </button>
          </form>
        )}

        {showControls && (
          <div className="groupbar">
            <span className="groupbar-label">group by</span>
            {agentAxis && !MANUAL_AXES.includes(agentAxis as (typeof MANUAL_AXES)[number]) && (
              <button
                className={activeAxis === agentAxis ? 'chip active' : 'chip'}
                onClick={() => handleRegroup(agentAxis)}
              >
                {agentAxis} ✦
              </button>
            )}
            {MANUAL_AXES.map((axis) => (
              <button
                key={axis}
                className={activeAxis === axis ? 'chip active' : 'chip'}
                onClick={() => handleRegroup(axis)}
              >
                {axis}
              </button>
            ))}
          </div>
        )}

        <div className="brandline">
          <button className="backbtn" onClick={onHome} title="Back to copyleft.gallery">
            ←
          </button>
          <img
            className="brand-mark"
            src="/logo.svg"
            alt=""
            draggable={false}
            onClick={onHome}
            title="Back to copyleft.gallery"
          />
          <button className="brand-name" onClick={onHome}>
            copyleft<span>.gallery</span>
          </button>
          <span className="brand-sep">/</span>
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="untitled curation"
            aria-label="Curation title"
          />
          <button
            className={logOpen ? 'logbtn active' : 'logbtn'}
            onClick={() => setLogOpen((v) => !v)}
            title="Agent audit log"
          >
            log
          </button>
          <button className="theme-toggle" onClick={onToggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☾' : '☀'}
          </button>
        </div>
      </div>

      {logOpen && (
        <LogPanel
          logs={logs}
          live={phase === 'running' || diveBusy}
          expanded={logExpanded}
          onToggleExpanded={() => setLogExpanded((v) => !v)}
          onClose={() => setLogOpen(false)}
        />
      )}
    </div>
  )
}
