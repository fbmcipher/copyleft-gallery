import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw'

// The catalog furniture of the exhibition: a title panel (show name +
// synthesis, embedded on the canvas — no floating chrome) and room headers
// (editorial heading + intro). All HTML so the brand Helvetica runs through.

export const PANEL_W = 720
export const PANEL_H = 1040

export type TitlePanelShape = TLBaseShape<
  'titlepanel',
  { w: number; h: number; title: string; synthesis: string; refs: string }
>

export class TitlePanelShapeUtil extends ShapeUtil<TitlePanelShape> {
  static override type = 'titlepanel' as const
  static override props: RecordProps<TitlePanelShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    synthesis: T.string,
    refs: T.string, // JSON [{title,url}]
  }

  getDefaultProps(): TitlePanelShape['props'] {
    return { w: PANEL_W, h: PANEL_H, title: '', synthesis: '', refs: '[]' }
  }

  override canEdit() {
    return false
  }
  override canResize() {
    return false
  }
  override hideRotateHandle() {
    return true
  }

  getGeometry(shape: TitlePanelShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  component(shape: TitlePanelShape) {
    const { title, synthesis, refs } = shape.props
    let links: { title: string; url: string }[] = []
    try {
      links = JSON.parse(refs)
    } catch {
      /* ignore */
    }
    const paragraphs = synthesis.split(/\n+/).filter(Boolean)
    // long show titles scale down instead of devouring the panel
    const titleSize = title.length > 64 ? 46 : title.length > 34 ? 62 : 84
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <div className="exhibit-panel">
          <h1 style={{ fontSize: titleSize }}>{title}</h1>
          <div className="exhibit-panel-body">
            {paragraphs.length ? (
              paragraphs.map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p className="dim">…</p>
            )}
          </div>
          {links.length > 0 && (
            <div className="exhibit-panel-refs">
              <span>sources</span>
              {links.map((r) => (
                <a
                  key={r.url}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.title}
                </a>
              ))}
            </div>
          )}
        </div>
      </HTMLContainer>
    )
  }

  indicator(shape: TitlePanelShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

// Continued Reading: adjacent shows worth mounting. Clicking a topic spawns a
// nested exhibition inside this canvas (CanvasView listens for the event).
export const READING_W = 640
export const READING_H = 460

export type ReadingPanelShape = TLBaseShape<
  'readingpanel',
  { w: number; h: number; topics: string }
>

export class ReadingPanelShapeUtil extends ShapeUtil<ReadingPanelShape> {
  static override type = 'readingpanel' as const
  static override props: RecordProps<ReadingPanelShape> = {
    w: T.number,
    h: T.number,
    topics: T.string, // JSON string[]
  }

  getDefaultProps(): ReadingPanelShape['props'] {
    return { w: READING_W, h: READING_H, topics: '[]' }
  }

  override canEdit() {
    return false
  }
  override canResize() {
    return false
  }
  override hideRotateHandle() {
    return true
  }

  getGeometry(shape: ReadingPanelShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  component(shape: ReadingPanelShape) {
    let topics: string[] = []
    try {
      topics = JSON.parse(shape.props.topics)
    } catch {
      /* ignore */
    }
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <div className="exhibit-reading">
          <div className="exhibit-reading-label">Continued Reading</div>
          {topics.map((topic) => (
            <button
              key={topic}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('clg:deepdive', { detail: { topic } }))
              }}
            >
              {topic} ↗
            </button>
          ))}
        </div>
      </HTMLContainer>
    )
  }

  indicator(shape: ReadingPanelShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

// Ask Question / Ask About: the curator's answer, pinned to the wall.
export const ANSWER_W = 560

export type AnswerPanelShape = TLBaseShape<
  'answerpanel',
  { w: number; h: number; question: string; answer: string; about: string }
>

export class AnswerPanelShapeUtil extends ShapeUtil<AnswerPanelShape> {
  static override type = 'answerpanel' as const
  static override props: RecordProps<AnswerPanelShape> = {
    w: T.number,
    h: T.number,
    question: T.string,
    answer: T.string,
    about: T.string,
  }

  getDefaultProps(): AnswerPanelShape['props'] {
    return { w: ANSWER_W, h: 420, question: '', answer: '', about: '' }
  }

  override canEdit() {
    return false
  }
  override canResize() {
    return false
  }
  override hideRotateHandle() {
    return true
  }

  getGeometry(shape: AnswerPanelShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  component(shape: AnswerPanelShape) {
    const { question, answer, about } = shape.props
    return (
      <HTMLContainer>
        <div className="exhibit-answer">
          <div className="exhibit-answer-q">
            {about && <span className="exhibit-answer-about">on “{about}” — </span>}
            {question}
          </div>
          <p>{answer || '…'}</p>
        </div>
      </HTMLContainer>
    )
  }

  indicator(shape: AnswerPanelShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}

export const ROOM_HEADER_H = 300

export type RoomHeaderShape = TLBaseShape<
  'roomheader',
  { w: number; h: number; heading: string; sub: string; note: string }
>

export class RoomHeaderShapeUtil extends ShapeUtil<RoomHeaderShape> {
  static override type = 'roomheader' as const
  static override props: RecordProps<RoomHeaderShape> = {
    w: T.number,
    h: T.number,
    heading: T.string,
    sub: T.string,
    note: T.string,
  }

  getDefaultProps(): RoomHeaderShape['props'] {
    return { w: 900, h: ROOM_HEADER_H, heading: '', sub: '', note: '' }
  }

  override canEdit() {
    return false
  }
  override canResize() {
    return false
  }
  override hideRotateHandle() {
    return true
  }

  getGeometry(shape: RoomHeaderShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  component(shape: RoomHeaderShape) {
    const { heading, sub, note } = shape.props
    return (
      <HTMLContainer>
        <div className="exhibit-room-header">
          <div className="exhibit-room-title">
            <strong>{heading}</strong>
            {sub && <span> {sub}</span>}
          </div>
          {note && <p>{note}</p>}
        </div>
      </HTMLContainer>
    )
  }

  indicator(shape: RoomHeaderShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}
