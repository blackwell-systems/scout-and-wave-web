// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useModal } from './useModal'

describe('useModal', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useModal())
    expect(result.current.isOpen).toBe(false)
  })

  it('opens when open() is called', () => {
    const { result } = renderHook(() => useModal())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
  })

  it('closes when close() is called', () => {
    const { result } = renderHook(() => useModal())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
  })

  it('toggles state', () => {
    const { result } = renderHook(() => useModal())
    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(false)
  })

  it('closes on Escape key when open', () => {
    const { result } = renderHook(() => useModal())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('does not react to Escape key when closed', () => {
    const { result } = renderHook(() => useModal())
    expect(result.current.isOpen).toBe(false)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('does not react to non-Escape keys', () => {
    const { result } = renderHook(() => useModal())
    act(() => result.current.open())

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('closes on backdrop click via portalProps', () => {
    const { result } = renderHook(() => useModal())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)

    act(() => result.current.portalProps.onBackdropClick())
    expect(result.current.isOpen).toBe(false)
  })

  it('closes on escape via portalProps.onEscape', () => {
    const { result } = renderHook(() => useModal())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)

    act(() => result.current.portalProps.onEscape())
    expect(result.current.isOpen).toBe(false)
  })

  it('accepts an optional id parameter', () => {
    const { result } = renderHook(() => useModal('settings'))
    expect(result.current.isOpen).toBe(false)
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
  })

  it('cleans up Escape listener on unmount', () => {
    const { result, unmount } = renderHook(() => useModal())
    act(() => result.current.open())

    unmount()

    // Should not throw - listener should be cleaned up
    expect(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }).not.toThrow()
  })

  it('cleans up Escape listener when modal closes', () => {
    const { result } = renderHook(() => useModal())

    // Open then close
    act(() => result.current.open())
    act(() => result.current.close())

    // Re-open, verify it still works
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.isOpen).toBe(false)
  })
})
