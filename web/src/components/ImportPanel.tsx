/**
 * ImportPanel — UI for importing existing IMPL docs into a PROGRAM manifest.
 *
 * Consumes POST /api/impl/import via sawClient.impl.importImpls().
 * Added by Wave 2 Agent G (webapp-api-parity).
 */

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Button } from './ui/button'
import { sawClient } from '../lib/apiClient'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportIMPLsRequest {
  program_slug: string
  impl_paths: string[]
  tier_map: Record<string, number>
  discover?: boolean
  repo_dir?: string
}

export interface ImportIMPLsResponse {
  program_path: string
  imported: string[]
  skipped: string[]
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface ImportPanelProps {
  /** Optional initial value for the program slug input. */
  initialProgramSlug?: string
}

export default function ImportPanel({ initialProgramSlug = '' }: ImportPanelProps): JSX.Element {
  const [programSlug, setProgramSlug] = useState<string>(initialProgramSlug)
  const [discoverMode, setDiscoverMode] = useState<boolean>(false)
  const [manualPaths, setManualPaths] = useState<string>('')
  const [tierMap, setTierMap] = useState<Record<string, number>>({})
  const [result, setResult] = useState<ImportIMPLsResponse | null>(null)
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleTierChange(slug: string, tier: number) {
    setTierMap((prev) => ({ ...prev, [slug]: tier }))
  }

  async function handleImport() {
    if (!programSlug.trim()) {
      setError('Program slug is required.')
      return
    }

    setIsImporting(true)
    setError(null)
    setResult(null)

    try {
      const implPaths = discoverMode
        ? []
        : manualPaths
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean)

      const req: ImportIMPLsRequest = {
        program_slug: programSlug.trim(),
        impl_paths: implPaths,
        tier_map: tierMap,
        discover: discoverMode,
      }

      // Cast needed because importImpls is added by Agent F and may not yet
      // be reflected in the SawClient type — the integration agent will wire
      // these together after wave merge.
      const response = await (sawClient.impl as any).importImpls(req) as ImportIMPLsResponse
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsImporting(false)
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const manualPathList = manualPaths
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)

  // When in discover mode, show tier dropdowns for paths already known from
  // previous results (imported slugs), otherwise show them for manual paths.
  const tierableSlugs = discoverMode
    ? result?.imported ?? []
    : manualPathList

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Import Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Import IMPLs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Program Slug */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="import-program-slug"
              className="text-xs font-medium text-muted-foreground"
            >
              Program slug
            </label>
            <input
              id="import-program-slug"
              type="text"
              value={programSlug}
              onChange={(e) => setProgramSlug(e.target.value)}
              placeholder="my-program"
              className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Discover Mode */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              id="import-discover-mode"
              type="checkbox"
              checked={discoverMode}
              onChange={(e) => setDiscoverMode(e.target.checked)}
              className="rounded border-border accent-primary"
            />
            <span className="text-sm">Auto-discover plans from docs/IMPL/</span>
          </label>

          {/* Manual IMPL paths */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="import-manual-paths"
              className="text-xs font-medium text-muted-foreground"
            >
              IMPL paths (one per line)
            </label>
            <textarea
              id="import-manual-paths"
              value={manualPaths}
              onChange={(e) => setManualPaths(e.target.value)}
              disabled={discoverMode}
              rows={4}
              placeholder={
                discoverMode
                  ? 'Disabled in auto-discover mode'
                  : 'docs/IMPL/IMPL-my-feature.yaml'
              }
              className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y disabled:opacity-50 disabled:cursor-not-allowed font-mono"
            />
          </div>

          {/* Tier assignment table — shown when there are slugs to assign */}
          {tierableSlugs.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">Tier assignment</p>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Plan</th>
                      <th className="px-3 py-2 text-left font-medium w-24">Tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tierableSlugs.map((slug) => (
                      <tr key={slug} className="border-t border-border">
                        <td className="px-3 py-2 font-mono truncate max-w-xs">{slug}</td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Tier for ${slug}`}
                            value={tierMap[slug] ?? 1}
                            onChange={(e) =>
                              handleTierChange(slug, Number(e.target.value))
                            }
                            className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            {[1, 2, 3, 4, 5].map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <Button
            onClick={handleImport}
            disabled={isImporting || !programSlug.trim()}
            className="self-start"
          >
            {isImporting ? 'Importing...' : 'Import IMPLs'}
          </Button>
        </CardContent>
      </Card>

      {/* Results Panel */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Import Results</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-6 text-sm">
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {result.imported.length}
                </span>
                <span className="text-xs text-muted-foreground">Imported</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-muted-foreground">
                  {result.skipped.length}
                </span>
                <span className="text-xs text-muted-foreground">Skipped (already present)</span>
              </div>
            </div>

            {result.imported.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Imported slugs</p>
                <ul className="flex flex-col gap-0.5">
                  {result.imported.map((slug) => (
                    <li key={slug} className="text-xs font-mono text-green-700 dark:text-green-300">
                      + {slug}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.skipped.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Skipped slugs</p>
                <ul className="flex flex-col gap-0.5">
                  {result.skipped.map((slug) => (
                    <li key={slug} className="text-xs font-mono text-muted-foreground">
                      = {slug}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.program_path && (
              <p className="text-xs text-muted-foreground">
                Program manifest:{' '}
                <span className="font-mono text-foreground">{result.program_path}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
