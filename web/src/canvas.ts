import { EASINGS, createShapeId, type Editor, type TLShapePartial } from 'tldraw'
import { CARD_W, CARD_H } from './ArtCardShape'
import { PANEL_W, PANEL_H, ROOM_HEADER_H, READING_W, READING_H } from './ExhibitShapes'
import type { Layout, ResearchRef, CardRecord } from './types'

// Exhibition-catalog layout: title panel on the left, rooms flowing
// horizontally, generous air between everything.
const GAP_X = 72
const GAP_Y = 96
const ROOM_GAP = 340
const PANEL_GAP = 260
const ANIM = { duration: 750, easing: EASINGS.easeInOutCubic }

export const cardShapeId = (objectId: string) =>
  createShapeId(`card-${objectId.replace(/[^a-zA-Z0-9_-]/g, '_')}`)

// §6: cards stream into a loose staging cluster first. Grouping happens only
// when a layout arrives — the axis isn't knowable up front.
function stagingPosition(index: number) {
  const cols = 8
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: col * (CARD_W + 40) + (Math.random() * 32 - 16),
    y: row * (CARD_H + 40) + (Math.random() * 32 - 16),
  }
}

export function addCardToStaging(
  editor: Editor,
  card: CardRecord,
  index: number,
  origin: { x: number; y: number } = { x: 0, y: 0 }
) {
  const id = cardShapeId(card.id)
  if (editor.getShape(id)) return
  const pos = stagingPosition(index)
  const x = origin.x + pos.x
  const y = origin.y + pos.y
  editor.createShape({
    id,
    type: 'artcard',
    x,
    y,
    props: {
      title: card.title,
      date: card.objectDate,
      sourceLabel: card.sourceLabel,
      artist: card.artist,
      image: card.image,
      url: card.url,
      ...(card.annotation ? { annotation: card.annotation } : {}),
    },
  })
}

// The floating top bar covers the top of the viewport; tldraw's zoomToFit
// doesn't know that, so fit the camera ourselves with that band reserved.
const TOPBAR_H = 220
const SCREEN_PAD = 48

function fitCameraTo(
  editor: Editor,
  bounds: { x: number; y: number; w: number; h: number },
  duration: number
) {
  const vsb = editor.getViewportScreenBounds()
  const availW = Math.max(100, vsb.w - SCREEN_PAD * 2)
  const availH = Math.max(100, vsb.h - TOPBAR_H - SCREEN_PAD * 2)
  const z = Math.min(1, availW / bounds.w, availH / bounds.h)
  const centerScreenX = vsb.w / 2
  const centerScreenY = TOPBAR_H + (vsb.h - TOPBAR_H) / 2
  editor.setCamera(
    {
      x: centerScreenX / z - (bounds.x + bounds.w / 2),
      y: centerScreenY / z - (bounds.y + bounds.h / 2),
      z,
    },
    { animation: { duration, easing: EASINGS.easeInOutCubic } }
  )
}

export function zoomToContent(editor: Editor, duration = 260) {
  const bounds = editor.getCurrentPageBounds()
  if (bounds) fitCameraTo(editor, bounds, duration)
}

// Animate every card from wherever it is (staging or a previous grouping)
// into the exhibition: title panel left, rooms flowing right, full images
// with placard captions. Grouping was decided upstream.
//
// opts.immediate places everything without animation (seed materialization).
// opts.pruneOrphans removes cards the layout doesn't reference (agent discard).
// opts.title/refs feed the embedded title panel (created when synthesis exists).
export function applyLayout(
  editor: Editor,
  layout: Layout,
  opts: {
    immediate?: boolean
    pruneOrphans?: boolean
    title?: string
    refs?: ResearchRef[]
    // nested exhibitions: a namespace scopes this band's furniture/cleanup,
    // an origin offsets it, scopeIds limit pruning to this band's own cards.
    ns?: string
    origin?: { x: number; y: number }
    scopeIds?: Set<string>
  } = {}
): void {
  const ns = opts.ns ?? 'main'
  const origin = opts.origin ?? { x: 0, y: 0 }

  // Furniture from earlier layouts of THIS band (+ legacy text labels).
  const stale = [...editor.getCurrentPageShapeIds()].filter(
    (id) =>
      id.startsWith(`shape:room-${ns}-`) ||
      id.startsWith(`shape:reading-${ns}`) ||
      (ns === 'main' && (id.startsWith('shape:label-') || id.startsWith('shape:note-') || id.startsWith('shape:room-0') || id.startsWith('shape:room-1') || id.startsWith('shape:room-2') || id.startsWith('shape:room-3') || id.startsWith('shape:room-4') || id.startsWith('shape:room-5') || id.startsWith('shape:room-6') || id.startsWith('shape:room-7')))
  )
  if (stale.length) editor.deleteShapes(stale)

  if (opts.pruneOrphans) {
    const referenced = new Set(layout.groups.flatMap((g) => g.objectIDs.map(cardShapeId)))
    const orphans = [...editor.getCurrentPageShapeIds()].filter((id) => {
      const shape = editor.getShape(id)
      if (shape?.type !== 'artcard' || referenced.has(id)) return false
      // never prune another band's cards
      return opts.scopeIds ? opts.scopeIds.has(id) : true
    })
    if (orphans.length) editor.deleteShapes(orphans)
  }

  // Authored wall labels: the curator's metadata replaces scraped junk.
  if (layout.annotations?.length) {
    const labelUpdates: TLShapePartial[] = []
    for (const a of layout.annotations) {
      const id = cardShapeId(a.id)
      if (!editor.getShape(id)) continue
      labelUpdates.push({
        id,
        type: 'artcard',
        props: {
          ...(a.title ? { title: a.title } : {}),
          ...(a.date ? { date: a.date } : {}),
          ...(a.artist ? { artist: a.artist } : {}),
          ...(a.note ? { annotation: a.note } : {}),
        },
      })
    }
    if (labelUpdates.length) editor.updateShapes(labelUpdates)
  }

  // Title panel: created once (agent layouts carry synthesis); regroups keep it.
  const panelId = createShapeId(`titlepanel-${ns}`)
  let panelH = PANEL_H
  if (layout.synthesis || opts.title) {
    const titleText = (opts.title || '').toUpperCase()
    const synthText = layout.synthesis || ''
    // estimate content height so long titles/syntheses never clip
    const tl = titleText.length
    const titleLines = Math.max(1, Math.ceil(tl / (tl > 64 ? 24 : tl > 34 ? 18 : 13)))
    const titleH = titleLines * (tl > 64 ? 52 : tl > 34 ? 68 : 88)
    const synthH = Math.ceil(synthText.length / 54) * 34
    panelH = Math.min(2800, Math.max(900, titleH + synthH + 260))
    const props = {
      title: titleText,
      synthesis: synthText,
      refs: JSON.stringify((opts.refs ?? []).slice(0, 6)),
      h: panelH,
    }
    if (editor.getShape(panelId)) {
      editor.updateShapes([
        {
          id: panelId,
          type: 'titlepanel',
          props: layout.synthesis ? props : { title: props.title },
        },
      ])
    } else {
      editor.createShape({
        id: panelId,
        type: 'titlepanel',
        x: origin.x - (PANEL_W + PANEL_GAP),
        y: origin.y,
        props,
      })
    }
  }

  const cardMoves: TLShapePartial[] = []
  let cursorX = 0
  let maxBottom = 0

  layout.groups.forEach((group, gi) => {
    const present = group.objectIDs.filter((oid) => editor.getShape(cardShapeId(oid)))
    if (!present.length) return

    // wide, airy rows: up to 3 columns per room
    const cols = Math.min(3, Math.max(1, Math.ceil(present.length / 2)))
    const rows = Math.ceil(present.length / cols)
    const width = Math.max(cols * CARD_W + (cols - 1) * GAP_X, 720)

    // "1. Architect's Eye — Mies and Koolhaas" → heading strong + sub light
    const raw = group.groupLabel
    const split = raw.split(/\s*[—–]\s*(.+)/)
    const heading = split[0].trim()
    const sub = (split[1] ?? '').trim()

    const headerId = createShapeId(`room-${ns}-${gi}-${layout.axis}`)
    editor.createShape({
      id: headerId,
      type: 'roomheader',
      x: origin.x + cursorX,
      y: origin.y - ROOM_HEADER_H,
      opacity: opts.immediate ? 1 : 0,
      props: {
        w: Math.min(width, 980),
        h: ROOM_HEADER_H,
        heading,
        sub,
        note: group.note ?? '',
      },
    })
    if (!opts.immediate) {
      cardMoves.push({ id: headerId, type: 'roomheader', opacity: 1 })
    }

    present.forEach((oid, i) => {
      cardMoves.push({
        id: cardShapeId(oid),
        type: 'artcard',
        x: origin.x + cursorX + (i % cols) * (CARD_W + GAP_X),
        y: origin.y + Math.floor(i / cols) * (CARD_H + GAP_Y),
        // normalize cards from older layouts to the current dimensions
        props: { w: CARD_W, h: CARD_H },
      })
    })

    maxBottom = Math.max(maxBottom, rows * CARD_H + (rows - 1) * GAP_Y)
    cursorX += width + ROOM_GAP
  })

  // Continued Reading: adjacent shows, hung after the last room.
  if (layout.furtherReading?.length) {
    editor.createShape({
      id: createShapeId(`reading-${ns}`),
      type: 'readingpanel',
      x: origin.x + cursorX,
      y: origin.y,
      props: {
        w: READING_W,
        h: Math.min(READING_H, 120 + layout.furtherReading.length * 64),
        topics: JSON.stringify(layout.furtherReading),
      },
    })
    cursorX += READING_W + ROOM_GAP
  }

  if (opts.immediate) {
    editor.updateShapes(cardMoves)
  } else {
    editor.animateShapes(cardMoves, { animation: ANIM })
  }

  // Zoom to the layout's final footprint (shape records interpolate during the
  // animation, so fitting to current page bounds would frame the staging pile).
  const totalWidth = Math.max(1, cursorX - ROOM_GAP)
  const hasPanel = Boolean(editor.getShape(panelId))
  const left = hasPanel ? origin.x - (PANEL_W + PANEL_GAP) : origin.x
  fitCameraTo(
    editor,
    {
      x: left - 60,
      y: origin.y - ROOM_HEADER_H - 60,
      w: origin.x + totalWidth - left + 120,
      h: Math.max(maxBottom, hasPanel ? panelH - ROOM_HEADER_H : 0) + ROOM_HEADER_H + 120,
    },
    opts.immediate ? 0 : ANIM.duration
  )
}

// Where a nested deep-dive band should start: below everything on the canvas,
// left-aligned with the main band's content origin.
export function nextBandOrigin(editor: Editor): { x: number; y: number } {
  const bounds = editor.getCurrentPageBounds()
  return { x: 0, y: bounds ? bounds.maxY + 900 : 0 }
}

// A spot for an answer panel: below the current content, near the given x.
export function answerSpot(editor: Editor, nearX: number): { x: number; y: number } {
  const bounds = editor.getCurrentPageBounds()
  return { x: nearX, y: bounds ? bounds.maxY + 140 : 0 }
}

// First open of a seeded exhibition: no snapshot exists yet, so build the
// canvas from the frozen records + stored layout, in place, no animation.
// The first autosave then freezes it into a shared, mutable instance.
export function materializeCuration(
  editor: Editor,
  records: CardRecord[],
  layout: Layout | null,
  opts: { title?: string; refs?: ResearchRef[] } = {}
) {
  records.forEach((record, i) => addCardToStaging(editor, record, i))
  if (layout) {
    applyLayout(editor, layout, { immediate: true, pruneOrphans: true, ...opts })
  } else {
    zoomToContent(editor, 0)
  }
}
