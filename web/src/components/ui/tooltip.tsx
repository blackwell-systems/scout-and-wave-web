import * as React from "react"

/**
 * Tooltip component for inline concept explanations.
 * Displays contextual help text on hover over wrapped children.
 *
 * Scaffold file — implementation provided by Wave 1 Agent A.
 */

export interface TooltipProps {
  /** Element to wrap (triggers tooltip on hover) */
  children: React.ReactNode
  /** Tooltip content (text or JSX) */
  content: string | React.ReactNode
  /** Tooltip position relative to children. Default: 'top' */
  position?: 'top' | 'bottom' | 'left' | 'right'
  /** Max width in pixels. Default: 300 */
  maxWidth?: number
}

export function Tooltip(props: TooltipProps): JSX.Element {
  // Stub — Wave 1 Agent A will implement CSS-only tooltip
  // using ::before pseudo-element and data attributes.
  return <>{props.children}</>
}
