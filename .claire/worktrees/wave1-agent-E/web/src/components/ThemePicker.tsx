import { useState, useEffect } from 'react'

export type ThemeId = 'default' | 'gruvbox-dark' | 'darcula' | 'catppuccin-mocha' | 'nord'

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'gruvbox-dark', label: 'Gruvbox' },
  { id: 'darcula', label: 'Darcula' },
  { id: 'catppuccin-mocha', label: 'Catppuccin' },
  { id: 'nord', label: 'Nord' },
]

const STORAGE_KEY = 'saw-theme'
const THEME_CLASSES: ThemeId[] = ['gruvbox-dark', 'darcula', 'catppuccin-mocha', 'nord']

function applyTheme(id: ThemeId) {
  const html = document.documentElement
  THEME_CLASSES.forEach(t => html.classList.remove(`theme-${t}`))
  if (id !== 'default') {
    html.classList.add(`theme-${id}`)
  }
}

export default function ThemePicker(): JSX.Element {
  const [theme, setTheme] = useState<ThemeId>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeId) ?? 'default'
  })

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    applyTheme((localStorage.getItem(STORAGE_KEY) as ThemeId) ?? 'default')
  }, [])

  return (
    <select
      value={theme}
      onChange={e => setTheme(e.target.value as ThemeId)}
      className="text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors cursor-pointer"
      title="Color theme"
    >
      {THEMES.map(t => (
        <option key={t.id} value={t.id}>{t.label}</option>
      ))}
    </select>
  )
}
