import { useState, useEffect } from 'react'

export function useDarkMode(): [boolean, () => void] {
  function getInitialDark(): boolean {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark') return true
    if (stored === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  const [isDark, setIsDark] = useState<boolean>(getInitialDark)

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [isDark])

  function toggle() {
    setIsDark(prev => !prev)
  }

  return [isDark, toggle]
}
