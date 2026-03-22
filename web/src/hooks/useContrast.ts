import { useState, useEffect } from 'react'
import { getConfig } from '../api'

// Read a CSS custom property from the document root as an "H S% L%" string.
function getVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Parse "H S% L%" → [h, s, l] numbers. Returns null if format is unexpected.
function parseHSL(val: string): [number, number, number] | null {
  const parts = val.trim().split(/\s+/)
  if (parts.length < 3) return null
  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1])
  const l = parseFloat(parts[2])
  if (isNaN(h) || isNaN(s) || isNaN(l)) return null
  return [h, s, l]
}

// Push lightness toward an extreme while preserving H and S.
// direction 'max' = push toward 100 (lighten), 'min' = push toward 0 (darken).
function boost(val: string, direction: 'max' | 'min', amount: number): string {
  const parsed = parseHSL(val)
  if (!parsed) return val
  const [h, s, l] = parsed
  const newL = direction === 'max'
    ? Math.min(l + amount, 100)
    : Math.max(l - amount, 0)
  return `${h} ${s}% ${newL}%`
}

// Build contrast override CSS by reading current computed theme vars and
// pushing their lightness values toward higher contrast — hue preserved.
function buildHighContrastCSS(): string {
  const isDark = document.documentElement.classList.contains('dark')

  if (isDark) {
    // Dark mode: push backgrounds darker, text & borders lighter
    return `.dark.high-contrast {
  --background: ${boost(getVar('--background'), 'min', 6)};
  --foreground: ${boost(getVar('--foreground'), 'max', 8)};
  --muted: ${boost(getVar('--muted'), 'min', 5)};
  --muted-foreground: ${boost(getVar('--muted-foreground'), 'max', 12)};
  --border: ${boost(getVar('--border'), 'max', 20)};
  --input: ${boost(getVar('--input'), 'min', 5)};
  --card: ${boost(getVar('--card'), 'min', 4)};
  --card-foreground: ${boost(getVar('--card-foreground'), 'max', 8)};
  --popover: ${boost(getVar('--popover'), 'min', 4)};
  --popover-foreground: ${boost(getVar('--popover-foreground'), 'max', 8)};
}
.high-contrast body { background-image: none; }`
  } else {
    // Light mode: push backgrounds lighter, text & borders darker
    return `.high-contrast {
  --background: ${boost(getVar('--background'), 'max', 4)};
  --foreground: ${boost(getVar('--foreground'), 'min', 8)};
  --muted: ${boost(getVar('--muted'), 'max', 4)};
  --muted-foreground: ${boost(getVar('--muted-foreground'), 'min', 12)};
  --border: ${boost(getVar('--border'), 'min', 20)};
  --input: ${boost(getVar('--input'), 'max', 4)};
  --card: ${boost(getVar('--card'), 'max', 3)};
  --card-foreground: ${boost(getVar('--card-foreground'), 'min', 8)};
  --popover: ${boost(getVar('--popover'), 'max', 3)};
  --popover-foreground: ${boost(getVar('--popover-foreground'), 'min', 8)};
}
.high-contrast body { background-image: none; }`
  }
}

function injectHighContrastStyles(): void {
  // Remove any existing injection FIRST so getComputedStyle reads the raw
  // theme values — not previously-boosted HC values. Without this, each
  // dark/light switch compounds the boost until it saturates and freezes.
  document.getElementById('saw-high-contrast')?.remove()
  const css = buildHighContrastCSS()
  const el = document.createElement('style')
  el.id = 'saw-high-contrast'
  el.textContent = css
  document.head.appendChild(el)
}

function removeHighContrastStyles(): void {
  document.getElementById('saw-high-contrast')?.remove()
}

export function useContrast(): [boolean, () => void] {
  const [isHighContrast, setIsHighContrast] = useState<boolean>(false)

  // Load contrast preference from config on mount
  useEffect(() => {
    getConfig().then(config => {
      const contrast = config.appearance?.contrast ?? 'normal'
      setIsHighContrast(contrast === 'high')
    }).catch(() => {})
  }, [])

  // Apply .high-contrast class + inject computed contrast overrides
  useEffect(() => {
    if (isHighContrast) {
      document.documentElement.classList.add('high-contrast')
      injectHighContrastStyles()
    } else {
      document.documentElement.classList.remove('high-contrast')
      removeHighContrastStyles()
      return
    }

    // Re-inject when dark mode or theme class changes so boosts stay correct.
    const observer = new MutationObserver(() => {
      if (document.documentElement.classList.contains('high-contrast')) {
        injectHighContrastStyles()
      }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [isHighContrast])

  function toggle() {
    const next = !isHighContrast
    setIsHighContrast(next)

    // Persist in background
    getConfig().then(async config => {
      const { saveConfig } = await import('../api')
      await saveConfig({
        ...config,
        appearance: {
          ...config.appearance,
          contrast: next ? 'high' : 'normal'
        }
      })
    }).catch(() => {})
  }

  return [isHighContrast, toggle]
}
