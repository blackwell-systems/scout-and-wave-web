import { useState, useEffect, useRef } from 'react'
import { Dices } from 'lucide-react'
import { THEMES, ThemeDef, varToHsl } from '../lib/themes'

const ALL_THEME_CLASSES = THEMES.map(t => `theme-${t.id}`)
const STORAGE_KEY = 'saw-theme'

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

function applyTheme(id: string) {
  const html = document.documentElement
  ALL_THEME_CLASSES.forEach(cls => html.classList.remove(cls))
  if (id !== 'default') html.classList.add(`theme-${id}`)
}

function themeMode(id: string): 'light' | 'dark' | 'default' {
  if (id === 'default') return 'default'
  return THEMES.find(t => t.id === id)?.mode ?? 'dark'
}

function SwatchDot({ theme, active, onClick, onHover }: {
  theme: ThemeDef; active: boolean; onClick: () => void; onHover: (label: string | null) => void
}) {
  const bg      = varToHsl(theme.vars['--background'] ?? '0 0% 20%')
  const accent  = varToHsl(theme.vars['--primary']    ?? '0 0% 60%')
  const border  = varToHsl(theme.vars['--border']     ?? '0 0% 40%')

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(theme.label)}
      onMouseLeave={() => onHover(null)}
      className="group relative"
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: bg,
        border: active ? `2px solid ${accent}` : `1.5px solid ${border}`,
        flexShrink: 0,
        boxShadow: active ? `0 0 0 2px ${accent}` : undefined,
        cursor: 'pointer',
        overflow: 'visible',
      }}
    >
      {/* accent stripe at bottom */}
      <span style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: 7,
        borderRadius: '0 0 4px 4px',
        background: accent,
        opacity: 0.85,
        overflow: 'hidden',
      }} />
      {/* floating label on hover */}
      <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-100 opacity-0 group-hover:opacity-100 z-50 shadow-lg">
        {theme.label}
      </span>
    </button>
  )
}

export default function ThemePicker(): JSX.Element {
  const [theme, setTheme]       = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? 'default')
  const [dark, setDark]         = useState<boolean>(isDarkMode)
  const [open, setOpen]         = useState(false)
  const [search, setSearch]     = useState('')
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null)
  const popoverRef          = useRef<HTMLDivElement>(null)
  const btnRef              = useRef<HTMLButtonElement>(null)

  // Watch dark class changes
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDarkMode()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // Reset on mode flip if current theme doesn't match new mode
  useEffect(() => {
    const mode = themeMode(theme)
    if (mode === 'default') return
    if ((mode === 'light' && dark) || (mode === 'dark' && !dark)) setTheme('default')
  }, [dark])

  // Apply + persist
  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  // Apply on mount
  useEffect(() => { applyTheme(localStorage.getItem(STORAGE_KEY) ?? 'default') }, [])

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node) &&
          !btnRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const q = search.toLowerCase()
  const visible = THEMES.filter(t =>
    t.mode === (dark ? 'dark' : 'light') &&
    (q === '' || t.label.toLowerCase().includes(q))
  )

  const currentTheme = THEMES.find(t => t.id === theme)
  const label = currentTheme?.label ?? 'Default'

  function pick(id: string) {
    setTheme(id)
  }

  function randomTheme() {
    const pool = THEMES.filter(t => t.mode === (dark ? 'dark' : 'light'))
    const next = pool[Math.floor(Math.random() * pool.length)]
    if (next) setTheme(next.id)
  }

  return (
    <div className="relative flex items-stretch">
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 text-xs text-foreground hover:bg-muted transition-colors border-r border-border"
        title="Color theme"
      >
        {currentTheme && (
          <span style={{
            width: 12, height: 12, borderRadius: 3, flexShrink: 0,
            background: varToHsl(currentTheme.vars['--primary'] ?? '0 0% 60%'),
          }} />
        )}
        {label}
      </button>

      <button
        onClick={randomTheme}
        className="flex items-center justify-center px-3 border-r border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Random theme"
      >
        <Dices size={15} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 z-50 mt-1 bg-popover border border-border rounded-lg shadow-xl flex flex-col"
          style={{ width: 280, maxHeight: '70vh' }}
        >
          {/* Search */}
          <div className="px-3 py-2 border-b border-border shrink-0">
            <input
              autoFocus
              type="text"
              placeholder="Search themes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Default option */}
          <div className="px-3 pt-2 pb-1 shrink-0">
            <button
              onClick={() => pick('default')}
              className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${
                theme === 'default'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Default
            </button>
          </div>

          {/* Swatch grid */}
          <div className="overflow-y-auto px-3 pb-3">
            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No themes match</p>
            ) : (
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: 'repeat(auto-fill, 28px)' }}
              >
                {visible.map(t => (
                  <SwatchDot
                    key={t.id}
                    theme={t}
                    active={t.id === theme}
                    onClick={() => pick(t.id)}
                    onHover={setHoveredLabel}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Label footer — shows hovered theme name, falls back to active */}
          <div className="px-3 py-1.5 border-t border-border shrink-0 text-xs text-muted-foreground truncate">
            {hoveredLabel ?? currentTheme?.label ?? 'Default'}
          </div>
        </div>
      )}
    </div>
  )
}
