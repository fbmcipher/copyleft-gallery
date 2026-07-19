import { useEffect, useMemo, useState } from 'react'
import { deleteCuration, getCurations } from './api'
import type { CurationMeta } from './types'

// "1d" style relative time, homepage list (§1/§3).
function relTime(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return `${Math.floor(s / (86400 * 30))}mo`
}

interface Tile {
  img: string
  artTitle: string
  curationId: string
  exhibition: string
}

const VERSION = '0.2'
const GIT_HASH = '8f8e82a' // static for now
// TODO: replace with the real donation address before sharing publicly
const DONATE_ETH_ADDRESS = '0x — set DONATE_ETH_ADDRESS in web/src/Home.tsx'

export default function Home({
  theme,
  onToggleTheme,
  onSearch,
  onOpenCuration,
}: {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onSearch: (q: string) => void
  onOpenCuration: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [curations, setCurations] = useState<CurationMeta[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [donateOpen, setDonateOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!donateOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDonateOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [donateOpen])

  useEffect(() => {
    getCurations().then(setCurations).catch(() => {})
  }, [])

  const recent = curations.filter((c) => !c.seeded && c.count > 0).slice(0, 8)
  const seeded = curations.filter((c) => c.seeded)

  // The generous half: the collection offers itself before you know what to
  // ask. Tiles come from the pre-seeded exhibitions, round-robin so no single
  // show dominates the wall.
  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = []
    const per = seeded.map((c) => ({ c, i: 0 }))
    let added = true
    while (added && out.length < 24) {
      added = false
      for (const s of per) {
        if (s.i < s.c.covers.length) {
          const cover = s.c.covers[s.i]
          out.push({
            img: cover.image,
            artTitle: cover.title,
            curationId: s.c.id,
            exhibition: s.c.title,
          })
          s.i++
          added = true
        }
      }
    }
    return out
  }, [seeded])

  // Brick rows: alternate wide/narrow so the wall reads as masonry.
  const rows = useMemo(() => {
    const r: Tile[][] = []
    for (let i = 0; i + 1 < tiles.length; i += 2) r.push([tiles[i], tiles[i + 1]])
    return r
  }, [tiles])

  return (
    <div className="home">
      <div className="home-left">
        <h1 className="home-headline">
          Instantly search 128+ sites, galleries, museums and cultural institutions.
        </h1>

        <form
          className="home-search"
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) onSearch(query.trim())
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="yves saint laurent history of garments"
            autoFocus
            aria-label="Search"
          />
          <button type="submit" aria-label="Search" disabled={!query.trim()} />
        </form>

        {recent.length > 0 && (
          <div className="home-recent">
            <div className="home-recent-label">YOUR RECENT CURATIONS</div>
            {recent.map((c) => (
              <div key={c.id} className="home-recent-item">
                <a
                  href={`#/c/${c.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenCuration(c.id)
                  }}
                >
                  {c.title}
                </a>
                <span className="home-recent-time">{relTime(c.modifiedAt)}</span>
                <button
                  type="button"
                  className="home-recent-delete"
                  disabled={deletingId === c.id}
                  aria-label={`Delete ${c.title}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete “${c.title}”? This can’t be undone.`)) return
                    setDeletingId(c.id)
                    try {
                      await deleteCuration(c.id)
                      setCurations((current) => current.filter((item) => item.id !== c.id))
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : 'Could not delete curation.')
                    } finally {
                      setDeletingId((current) => (current === c.id ? null : current))
                    }
                  }}
                >
                  {deletingId === c.id ? 'deleting…' : 'delete'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="home-footer">
          <img className="copyleft-mark" src="/logo.svg" alt="copyleft" draggable={false} />
          <div className="home-footer-line">
            <span className="home-footer-brand">
              copyleft<span>.gallery</span>
            </span>
            <span className="home-footer-sep">/</span>
            <span className="home-footer-tag">online art gallery</span>
          </div>
        </div>
      </div>

      <div className="home-right">
        {rows.length > 0 && (
          <div className="home-ticker" style={{ animationDuration: `${rows.length * 14}s` }}>
            {[0, 1].map((rep) => (
              <div key={rep} aria-hidden={rep === 1}>
                {rows.map((row, ri) => (
                  <div className={`tile-row ${ri % 2 ? 'alt' : ''}`} key={`${rep}-${ri}`}>
                    {row.map((tile, ti) => (
                      <button
                        key={ti}
                        className="tile"
                        onClick={() => onOpenCuration(tile.curationId)}
                      >
                        <img src={tile.img} alt={tile.artTitle} loading="lazy" draggable={false} />
                        <span className="tile-label">
                          {tile.artTitle}
                          <em>{tile.exhibition}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="home-mobile-brand">
          <img className="copyleft-mark" src="/logo.svg" alt="copyleft" draggable={false} />
          <div className="home-mobile-brand-name">
            <span className="home-mobile-brand-wordmark">
              copyleft<span>.gallery</span>
            </span>
            <span className="home-mobile-brand-sep">/</span>
            <span className="home-mobile-brand-tag">online art gallery</span>
          </div>
        </div>
        <div className="home-corner">
          <div className="theme-switch">
            <button
              className={theme === 'light' ? 'on' : ''}
              onClick={() => theme !== 'light' && onToggleTheme()}
            >
              light
            </button>
            <span className="home-version-sep">|</span>
            <button
              className={theme === 'dark' ? 'on' : ''}
              onClick={() => theme !== 'dark' && onToggleTheme()}
            >
              dark
            </button>
          </div>
          <div className="home-version">
            <span>
              {VERSION} {GIT_HASH}
            </span>
            <span className="home-version-sep">|</span>
            <button className="donate-link" onClick={() => setDonateOpen(true)}>
              donate ETH
            </button>
          </div>
        </div>
      </div>

      {donateOpen && (
        <div className="modal-backdrop" onClick={() => setDonateOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">donate ETH</div>
            <button
              className="modal-address"
              title="Click to copy"
              onClick={() => {
                navigator.clipboard?.writeText(DONATE_ETH_ADDRESS).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {DONATE_ETH_ADDRESS}
            </button>
            <div className="modal-hint">{copied ? 'copied' : 'click address to copy'}</div>
            <button className="modal-close" onClick={() => setDonateOpen(false)}>
              close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
