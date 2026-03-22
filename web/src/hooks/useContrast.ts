import { useState, useEffect } from 'react'
import { getConfig } from '../api'

// High-contrast CSS variable overrides, injected as a <style> tag so they
// beat theme variables (which are also injected as unlayered <style> tags).
// @layer base rules lose to unlayered rules regardless of source order.
const HC_LIGHT = `
.high-contrast {
  --background: 0 0% 100%;
  --foreground: 0 0% 0%;
  --muted: 0 0% 85%;
  --muted-foreground: 0 0% 15%;
  --border: 0 0% 0%;
  --input: 0 0% 85%;
  --ring: 240 100% 40%;
  --primary: 240 100% 35%;
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 0%;
  --secondary-foreground: 0 0% 100%;
  --accent: 240 100% 35%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 100% 30%;
  --destructive-foreground: 0 0% 100%;
  --card: 0 0% 95%;
  --card-foreground: 0 0% 0%;
  --popover: 0 0% 95%;
  --popover-foreground: 0 0% 0%;
}`

const HC_DARK = `
.dark.high-contrast {
  --background: 0 0% 0%;
  --foreground: 0 0% 100%;
  --muted: 0 0% 15%;
  --muted-foreground: 0 0% 90%;
  --border: 0 0% 100%;
  --input: 0 0% 15%;
  --ring: 60 100% 60%;
  --primary: 60 100% 60%;
  --primary-foreground: 0 0% 0%;
  --secondary: 0 0% 100%;
  --secondary-foreground: 0 0% 0%;
  --accent: 60 100% 60%;
  --accent-foreground: 0 0% 0%;
  --destructive: 0 100% 60%;
  --destructive-foreground: 0 0% 0%;
  --card: 0 0% 10%;
  --card-foreground: 0 0% 100%;
  --popover: 0 0% 10%;
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
