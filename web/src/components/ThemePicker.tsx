import { useState, useEffect, useRef } from 'react'
import { Dices, Star } from 'lucide-react'
import { THEMES, ThemeDef, varToHsl } from '../lib/themes'
import { getConfig, saveConfig } from '../api'

const ALL_THEME_CLASSES = THEMES.map(t => `theme-${t.id}`)

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
  theme: ThemeDef; active: boolean; onClick: () => void; onHover: (theme: ThemeDef | null) => void
}) {
  const bg      = varToHsl(theme.vars['--background'] ?? '0 0% 20%')
  const accent  = varToHsl(theme.vars['--primary']    ?? '0 0% 60%')
  const border  = varToHsl(theme.vars['--border']     ?? '0 0% 40%')

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(theme)}
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
  const [theme, setTheme]       = useState<string>('default')
  const [dark, setDark]         = useState<boolean>(isDarkMode)
  const [open, setOpen]         = useState(false)
  const [search, setSearch]     = useState('')
  const [hoveredTheme, setHoveredTheme] = useState<ThemeDef | null>(null)
  const [savedMsg, setSavedMsg] = useState(false)
  const [favoritesDark, setFavoritesDark] = useState<string[]>([])
  const [favoritesLight, setFavoritesLight] = useState<string[]>([])
  const popoverRef          = useRef<HTMLDivElement>(null)
  const btnRef              = useRef<HTMLButtonElement>(null)

  // Load theme and favorites from config on mount
  useEffect(() => {
    getConfig().then(config => {
      const savedTheme = config.appearance?.color_theme ?? 'default'
      setTheme(savedTheme)
      applyTheme(savedTheme)
      setFavoritesDark(config.appearance?.favorite_themes_dark ?? [])
      setFavoritesLight(config.appearance?.favorite_themes_light ?? [])
    }).catch(() => {})
  }, [])

  // Watch dark class changes
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDarkMode()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // Reload theme from config on mode flip
  useEffect(() => {
    getConfig().then(config => {
      const savedTheme = config.appearance?.color_theme ?? 'default'
      const mode = themeMode(savedTheme)
      if (mode === 'default') return
      if ((mode === 'light' && dark) || (mode === 'dark' && !dark)) {
        setTheme(savedTheme)
        applyTheme(savedTheme)
      }
    }).catch(() => {})
  }, [dark])

  // Apply theme
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

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
  const currentFavorites = dark ? favoritesDark : favoritesLight
  const allVisible = THEMES.filter(t =>
    t.mode === (dark ? 'dark' : 'light') &&
    (q === '' || t.label.toLowerCase().includes(q))
  )

  const favoritesVisible = allVisible.filter(t => currentFavorites.includes(t.id))
  const nonFavoritesVisible = allVisible.filter(t => !currentFavorites.includes(t.id))

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

  async function makeDefault() {
    try {
      const config = await getConfig()
      const updated = {
        ...config,
        appearance: {
          ...config.appearance,
          color_theme: theme
        }
      }
      await saveConfig(updated)
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2000)
    } catch {
      // silent fail
    }
  }

  async function toggleFavorite(themeId: string, mode: 'dark' | 'light') {
    try {
      const config = await getConfig()
      const currentFavorites = mode === 'dark'
        ? (config.appearance?.favorite_themes_dark ?? [])
        : (config.appearance?.favorite_themes_light ?? [])

      const newFavorites = currentFavorites.includes(themeId)
        ? currentFavorites.filter(id => id !== themeId)
        : [...currentFavorites, themeId]

      const updated = {
        ...config,
        appearance: {
          ...config.appearance,
          ...(mode === 'dark'
            ? { favorite_themes_dark: newFavorites }
            : { favorite_themes_light: newFavorites }
          )
        }
      }
      await saveConfig(updated)

      if (mode === 'dark') {
        setFavoritesDark(newFavorites)
      } else {
        setFavoritesLight(newFavorites)
      }
    } catch {
      // silent fail
    }
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
            {allVisible.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No themes match</p>
            ) : (
              <>
                {/* Favorites section */}
                {favoritesVisible.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground/70 mb-1.5 font-medium">Favorites</p>
                    <div
                      className="grid gap-1.5 mb-3"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, 28px)' }}
                    >
                      {favoritesVisible.map(t => (
                        <SwatchDot
                          key={t.id}
                          theme={t}
                          active={t.id === theme}
                          onClick={() => pick(t.id)}
                          onHover={setHoveredTheme}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* All themes section */}
                {nonFavoritesVisible.length > 0 && (
                  <>
                    {favoritesVisible.length > 0 && (
                      <p className="text-xs text-muted-foreground/70 mb-1.5 font-medium">All Themes</p>
                    )}
                    <div
                      className="grid gap-1.5"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, 28px)' }}
                    >
                      {nonFavoritesVisible.map(t => (
                        <SwatchDot
                          key={t.id}
                          theme={t}
                          active={t.id === theme}
                          onClick={() => pick(t.id)}
                          onHover={setHoveredTheme}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Label footer — shows hovered theme name, falls back to active */}
          <div className="px-3 py-1.5 border-t border-border shrink-0 text-xs text-muted-foreground truncate">
            {hoveredTheme?.label ?? currentTheme?.label ?? 'Default'}
          </div>

          {/* Action buttons */}
          <div className="px-3 pb-2 shrink-0 border-t border-border space-y-1.5">
            <button
              onClick={makeDefault}
              className="w-full mt-2 px-3 py-1.5 text-xs font-medium rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-colors"
            >
              {savedMsg ? '✓ Saved as Default' : 'Make Default'}
            </button>
            <button
              onClick={() => {
                const targetId = hoveredTheme?.id ?? theme
                if (targetId !== 'default') {
                  toggleFavorite(targetId, dark ? 'dark' : 'light')
                }
              }}
              disabled={theme === 'default' && !hoveredTheme}
              className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-500 border border-yellow-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <Star size={11} className={currentFavorites.includes(hoveredTheme?.id ?? theme) ? 'fill-current' : ''} />
              {currentFavorites.includes(hoveredTheme?.id ?? theme) ? 'Remove from Favorites' : 'Add to Favorites'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
