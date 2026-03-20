import { useState, useCallback, useEffect, useMemo } from 'react'

export interface UseModalReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  portalProps: {
    onBackdropClick: () => void
    onEscape: () => void
  }
}

/**
 * Hook to manage modal open/close state, backdrop clicks, and Escape key dismissal.
 * Replaces scattered createPortal + useState patterns.
 *
 * @param id - Optional identifier for tracking which modal is open when multiple exist.
 */
export function useModal(_id?: string): UseModalReturn {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen(prev => !prev), [])

  // Register Escape key listener when modal is open
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const portalProps = useMemo(() => ({
    onBackdropClick: () => setIsOpen(false),
    onEscape: () => setIsOpen(false),
  }), [])

  return { isOpen, open, close, toggle, portalProps }
}
