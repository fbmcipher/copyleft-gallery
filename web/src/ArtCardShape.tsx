import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw'

export const CARD_W = 380
export const CARD_H = 560
export const CARD_IMG_H = 290

export type ArtCardShape = TLBaseShape<
  'artcard',
  {
    w: number
    h: number
    title: string
    date: string
    sourceLabel: string
    artist: string
    image: string
    url: string
    annotation?: string
  }
>

export class ArtCardShapeUtil extends ShapeUtil<ArtCardShape> {
  static override type = 'artcard' as const
  static override props: RecordProps<ArtCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    date: T.string,
    sourceLabel: T.string,
    artist: T.string,
    image: T.string,
    url: T.string,
    // optional so snapshots from before authored labels still validate
    annotation: T.string.optional(),
  }

  getDefaultProps(): ArtCardShape['props'] {
    return {
      w: CARD_W,
      h: CARD_H,
      title: '',
      date: '',
      sourceLabel: '',
      artist: '',
      image: '',
      url: '',
    }
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

  getGeometry(shape: ArtCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  component(shape: ArtCardShape) {
    const { title, date, sourceLabel, artist, image, url, annotation } = shape.props
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <div className="artcard">
          <div className="artcard-imgwrap">
            <img src={image} alt={title} draggable={false} loading="lazy" />
          </div>
          <div className="artcard-caption">
            <div className="artcard-line">
              <span className="artcard-title">“{title}”</span>
              {artist && <span className="artcard-artist"> {artist}</span>}
              <span className="artcard-date"> {date || 'n.d.'}</span>
            </div>
            {annotation && <p className="artcard-note">{annotation}</p>}
            <div className="artcard-source">
              <span>{sourceLabel}</span>
              <button
                className="artcard-info"
                title="View source"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(url, '_blank', 'noopener,noreferrer')
                }}
              >
                ⓘ
              </button>
            </div>
          </div>
        </div>
      </HTMLContainer>
    )
  }

  indicator(shape: ArtCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} />
  }
}
