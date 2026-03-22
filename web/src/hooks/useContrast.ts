import { useState, useEffect } from 'react'
import { getConfig } from '../api'

// High-contrast CSS variable overrides, injected as a <style> tag so they
// beat theme variables (which are also injected as unlayered <style> tags).
// @layer base rules lose to unlayered rules regardless of source order.
// Only override readability variables — backgrounds, foregrounds, borders.
// Do NOT touch --primary/--accent/--secondary/--destructive/--ring so the
// user's selected theme colors are preserved.
const HC_LIGHT = `
.high-contrast {
  --background: 0 0% 100%;
  --foreground: 0 0% 0%;
  --muted: 0 0% 88%;
  --muted-foreground: 0 0% 10%;
  --border: 0 0% 0%;
  --input: 0 0% 88%;
  --card: 0 0% 96%;
  --card-foreground: 0 0% 0%;
  --popover: 0 0% 96%;
  --popover-foreground: 0 0% 0%;
}`

const HC_DARK = `
.dark.high-contrast {
  --background: 0 0% 0%;
  --foreground: 0 0% 100%;
  --muted: 0 0% 12%;
  --muted-foreground: 0 0% 92%;
  --border: 0 0% 100%;
  --input: 0 0% 12%;
  --card: 0 0% 8%;
  --card-foreground: 0 0% 100%;
  --popover: 0 0% 8%;
  --popover-foreground: 0 0% 100%;
}
.high-contrast body { background-image: none; }`

function injectHighContrastStyles(): void {
  if (document.getElementById('saw-high-contrast')) return
  const style = document.createElement('style')
  style.id = 'saw-high-contrast'
  style.textContent = HC_LIGHT + HC_DARK
  document.head.appendChild(style)
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

  // Apply .high-contrast class + inject override style tag to beat theme vars
  useEffect(() => {
    if (isHighContrast) {
      document.documentElement.classList.add('high-contrast')
      injectHighContrastStyles()
    } else {
      document.documentElement.classList.remove('high-contrast')
      removeHighContrastStyles()
    }
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
