import { useCallback, useEffect, useState } from 'react'
import Home from './Home'
import CanvasView, { type CanvasMode } from './CanvasView'

// Two doors (spec v0.2 §2): the search box for "I know what I want", the
// preview wall for "show me". Hash routing keeps both linkable without a router.
type Route = { view: 'home' } | { view: 'canvas'; mode: CanvasMode }

function parseHash(): Route {
  const h = window.location.hash
  const restore = h.match(/^#\/c\/([a-zA-Z0-9-]+)/)
  if (restore) return { view: 'canvas', mode: { kind: 'restore', id: restore[1] } }
  const fresh = h.match(/^#\/new\?q=(.+)$/)
  if (fresh) return { view: 'canvas', mode: { kind: 'new', query: decodeURIComponent(fresh[1]) } }
  return { view: 'home' }
}

type Theme = 'dark' | 'light'

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash)
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('clg-theme') as Theme) || 'dark'
  )

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('clg-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  const goHome = useCallback(() => {
    window.location.hash = '#/'
  }, [])

  if (route.view === 'canvas') {
    const key = route.mode.kind === 'restore' ? `c-${route.mode.id}` : `new-${route.mode.query}`
    return (
      <CanvasView
        key={key}
        mode={route.mode}
        theme={theme}
        onToggleTheme={toggleTheme}
        onHome={goHome}
      />
    )
  }

  return (
    <Home
      theme={theme}
      onToggleTheme={toggleTheme}
      onSearch={(q) => {
        window.location.hash = `#/new?q=${encodeURIComponent(q)}`
      }}
      onOpenCuration={(id) => {
        window.location.hash = `#/c/${id}`
      }}
    />
  )
}
