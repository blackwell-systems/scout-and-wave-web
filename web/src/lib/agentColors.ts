// Agent color scheme - golden angle generation for 26 letters + multi-generation support

const GOLDEN_ANGLE = 137.508

/**
 * Parse agent ID into base letter and generation number.
 * Examples: "A" → {letter: "A", generation: 1}, "A2" → {letter: "A", generation: 2}
 *
 * @param agent - Agent identifier (A, B, A2, B3, etc.)
 * @returns Parsed agent or null if invalid
 */
function parseAgentId(agent: string): { letter: string; generation: number } | null {
  const normalized = agent.toUpperCase().trim()
  const match = normalized.match(/^([A-Z])([2-9])?$/)
  if (!match) return null

  const letter = match[1]
  const generation = match[2] ? parseInt(match[2], 10) : 1
  return { letter, generation }
}

/**
 * Calculate hue for a letter using golden angle distribution.
 * Each letter A-Z gets a unique hue evenly distributed around the color wheel.
 *
 * @param letter - Single uppercase letter A-Z
 * @returns Hue value (0-360)
 */
function calculateHue(letter: string): number {
  const charCode = letter.charCodeAt(0)
  const index = charCode - 65 // A=0, B=1, ..., Z=25
  return (index * GOLDEN_ANGLE) % 360
}

/**
 * Calculate lightness for a generation, accounting for dark mode.
 * Generation 1 starts at base lightness, subsequent generations vary.
 *
 * Light mode: L decreases by 8% per generation (50% → 42% → 34% → ...)
 * Dark mode: L increases by 6% per generation (60% → 66% → 72% → ...)
 *
 * @param generation - Generation number (1-9)
 * @param isDark - Whether dark mode is active
 * @returns Lightness percentage (0-100)
 */
function calculateLightness(generation: number, isDark: boolean): number {
  if (isDark) {
    const baseLightness = 60
    return baseLightness + (generation - 1) * 6
  } else {
    const baseLightness = 50
    return baseLightness - (generation - 1) * 8
  }
}

/**
 * Detect if dark mode is currently active.
 * Uses Tailwind's class-based dark mode detection.
 *
 * @returns True if dark mode is active
 */
function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

/**
 * Convert HSL to hex color.
 *
 * @param h - Hue (0-360)
 * @param s - Saturation (0-100)
 * @param l - Lightness (0-100)
 * @returns Hex color code (#rrggbb)
 */
function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100
  const lNorm = l / 100

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lNorm - c / 2

  let r = 0, g = 0, b = 0

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x
  }

  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0')
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0')
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0')

  return `#${rHex}${gHex}${bHex}`
}

/**
 * Get the color for an agent by ID using golden angle (137.508°).
 * Supports single-letter (A-Z) and multi-generation IDs (A2, B3, etc.).
 *
 * Algorithm:
 * - Extract base letter (A-Z) and generation number (1 if omitted, 2-9 explicit)
 * - Base hue: (charCode - 65) * 137.508 % 360
 * - Multi-generation: vary lightness within same hue family
 *   - Generation 1 (base letter): L=50% (light mode), L=60% (dark mode)
 *   - Generation 2+: L decreases by 8% per generation in light mode,
 *                    L increases by 6% per generation in dark mode
 *
 * @param agent - Agent identifier (A, B, A2, B3, etc.)
 * @returns Hex color code (#rrggbb)
 */
export function getAgentColor(agent: string): string {
  const parsed = parseAgentId(agent)
  if (!parsed) return '#6b7280' // gray fallback

  const hue = calculateHue(parsed.letter)
  const lightness = calculateLightness(parsed.generation, isDarkMode())
  const saturation = 70 // Fixed saturation for vibrant colors

  return hslToHex(hue, saturation, lightness)
}

/**
 * Get opacity variant of agent color for backgrounds.
 * Uses the same golden angle + multi-generation logic as getAgentColor.
 *
 * @param agent - Agent identifier (A, B, A2, B3, etc.)
 * @param opacity - Opacity value (0-1), defaults to 0.1
 * @returns rgba color string (rgba(r, g, b, opacity))
 */
export function getAgentColorWithOpacity(agent: string, opacity: number = 0.1): string {
  const color = getAgentColor(agent)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
