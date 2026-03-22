import { useState, useEffect, useRef } from 'react'

interface ResizableDividerOptions {
  initialWidthPx?: number
  minWidthPx?: number
  maxFraction?: number
}

interface ResizableDividerResult {
  leftWidthPx: number
  isDragging: boolean
  dividerProps: {
    onMouseDown: (e: React.MouseEvent) => void
    style: React.CSSProperties
    className: string
  }
}

export function useResizableDivider(options?: ResizableDividerOptions): ResizableDividerResult {
  const initialWidthPx = options?.initialWidthPx ?? 260
  const minWidthPx = options?.minWidthPx ?? 180
  const maxFraction = options?.maxFraction ?? 0.40

  const [leftWidthPx, setLeftWidthPx] = useState<number>(initialWidthPx)
  const [isDragging, setIsDragging] = useState(false)

  const mouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null)
  const mouseUpRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      if (mouseMoveRef.current) {
        document.removeEventListener('mousemove', mouseMoveRef.current)
      }
      if (mouseUpRef.current) {
        document.removeEventListener('mouseup', mouseUpRef.current)
      }
    }
  }, [])

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    setIsDragging(true)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setLeftWidthPx(
        Math.max(minWidthPx, Math.min(moveEvent.clientX, window.innerWidth * maxFraction))
      )
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      mouseMoveRef.current = null
      mouseUpRef.current = null
    }

    mouseMoveRef.current = handleMouseMove
    mouseUpRef.current = handleMouseUp

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return {
    leftWidthPx,
    isDragging,
    dividerProps: {
      onMouseDown,
      style: { width: '4px', flexShrink: 0, alignSelf: 'stretch' },
      className: 'cursor-col-resize select-none bg-border hover:bg-primary/30 transition-colors',
    },
  }
}
