// Agent color scheme - golden angle generation for 26 letters + multi-generation support
// Saturation and lightness base are derived from the active CSS theme vars at render time.

const GOLDEN_ANGLE = 137.508

// ── Theme var cache ─────────────────────────────────────────────────────────
// Cached after first read, invalidated by resetThemeCache() (called on theme change).

interface ThemeVars {
  saturation: number    // clamped primary S, used for all agent colors
  baseLightness: number // contrast-safe base L against current background
}

let cachedThemeVars: ThemeVars | null = null

/**
 * Read --primary and --background from active CSS custom properties and derive
 * saturation + base-lightness values suitable for agent colors.
 *
 * Saturation: taken from --primary's S channel, clamped to [55, 85].
 *   Low-saturation themes (Nord, Solarized) → softer agent palette.
 *   High-saturation themes (Dracula, GitHub) → vivid agent palette.
 *
 * Lightness: contrast offset from --background's L channel.
 *   Dark bg (L≈12%) → agent L ≈ 60–68%   (light colors on dark bg)
 *   Light bg (L≈97%) → agent L ≈ 42–50%  (medium colors on light bg)
 */
function readThemeVars(): ThemeVars {
  if (typeof document === 'undefined') return { saturation: 70, baseLightness: 60 }

  const style = getComputedStyle(document.documentElement)

  // --primary is stored as "H S% L%" — parseFloat handles the % suffix correctly
  const primaryRaw = style.getPropertyValue('--primary').trim()
  const primaryParts = primaryRaw.split(/\s+/)
  const primaryS = primaryParts.length >= 2 ? parseFloat(primaryParts[1]) : 70
  const saturation = Math.min(85, Math.max(55, primaryS))

  // --background lightness tells us what we're drawing on top of
  const bgRaw = style.getPropertyValue('--background').trim()
  const bgParts = bgRaw.split(/\s+/)
  const bgL = bgParts.length >= 3 ? parseFloat(bgParts[2]) : (isDarkMode() ? 4 : 100)

  const dark = isDarkMode()
  const baseLightness = dark
    ? Math.min(75, Math.max(55, bgL + 48))   // e.g. bgL=12 → 60, bgL=22 → 70
    : Math.min(55, Math.max(30, bgL - 52))   // e.g. bgL=97 → 45, bgL=94 → 42

  return { saturation, baseLightness }
}

function getThemeVars(): ThemeVars {
  if (!cachedThemeVars) cachedThemeVars = readThemeVars()
  return cachedThemeVars
}

/**
 * Invalidate the theme var cache. Call this whenever the active theme changes
 * (dark mode toggle or color theme switch) so the next render picks up fresh values.
 */
export function resetThemeCache(): void {
  cachedThemeVars = null
}

// ── Core color math ─────────────────────────────────────────────────────────

/**
 * Parse agent ID into base letter and generation number.
 * Examples: "A" → {letter: "A", generation: 1}, "A2" → {letter: "A", generation: 2}
 */
function parseAgentId(agent: string): { letter: string; generation: number } | null {
  const normalized = agent.toUpperCase().trim()
  const match = normalized.match(/^([A-Z])([2-9])?$/)
  if (!match) return null
  return {
    letter: match[1],
    generation: match[2] ? parseInt(match[2], 10) : 1,
  }
}

/**
 * Calculate hue for a letter using golden angle distribution.
 * Each letter A-Z gets a unique hue maximally separated from its neighbors.
 */
function calculateHue(letter: string): number {
  const index = letter.charCodeAt(0) - 65 // A=0, B=1, ..., Z=25
  return (index * GOLDEN_ANGLE) % 360
}

/**
 * Calculate lightness for a generation relative to the theme's base lightness.
 *
 * Dark mode: L increases by 6% per generation (base → base+6 → base+12 → ...)
 * Light mode: L decreases by 8% per generation (base → base-8 → base-16 → ...)
 */
function calculateLightness(generation: number, baseLightness: number, isDark: boolean): number {
  return isDark
    ? baseLightness + (generation - 1) * 6
    : baseLightness - (generation - 1) * 8
}

/**
 * Detect if dark mode is currently active (Tailwind class-based).
 */
function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

/**
 * Convert HSL to hex color.
 */
function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100
  const lNorm = l / 100

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lNorm - c / 2

  let r = 0, g = 0, b = 0

  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }

  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0')
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0')
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0')

  return `#${rHex}${gHex}${bHex}`
}

// ── Repo colors (hash-based) ─────────────────────────────────────────────────

/**
 * Hash a string to a deterministic hue (0-359).
 * Uses djb2 hash for fast, well-distributed results.
 */
function hashToHue(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

/**
 * Get a deterministic color for a repository name.
 * Uses the same theme-aware saturation/lightness as agent colors
 * so repo colors feel consistent with the rest of the UI.
 *
 * @param repoName - Repository name (e.g. "scout-and-wave-go")
 * @returns Hex color code (#rrggbb)
 */
export function getRepoColor(repoName: string): string {
  const { saturation, baseLightness } = getThemeVars()
  const hue = hashToHue(repoName)
  return hslToHex(hue, saturation, baseLightness)
}

/**
 * Get opacity variant of repo color for backgrounds/borders.
 */
export function getRepoColorWithOpacity(repoName: string, opacity: number = 0.15): string {
  const color = getRepoColor(repoName)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the color for an agent by ID using golden angle (137.508°).
 * Saturation and lightness are derived from the active theme's CSS custom properties.
 *
 * @param agent - Agent identifier (A, B, A2, B3, etc.)
 * @returns Hex color code (#rrggbb)
 */
export function getAgentColor(agent: string): string {
  const parsed = parseAgentId(agent)
  if (!parsed) return '#6b7280' // gray fallback

  const { saturation, baseLightness } = getThemeVars()
  const hue = calculateHue(parsed.letter)
  const lightness = calculateLightness(parsed.generation, baseLightness, isDarkMode())

  return hslToHex(hue, saturation, lightness)
}

/**
 * Get opacity variant of agent color for backgrounds.
 *
 * @param agent - Agent identifier (A, B, A2, B3, etc.)
 * @param opacity - Opacity value (0-1), defaults to 0.1
 * @returns rgba color string
 */
export function getAgentColorWithOpacity(agent: string, opacity: number = 0.1): string {
  const color = getAgentColor(agent)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
