// DisjointAnalysisScreen — full-view component showing IMPL conflict analysis
// results and a confirm/create action for generating a PROGRAM manifest.

import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { ArrowLeft, CheckCircle2, AlertTriangle, Layers, FileWarning } from 'lucide-react'
import type { ConflictReport } from '../types/program'

interface DisjointAnalysisScreenProps {
  slugs: string[]
  conflictReport: ConflictReport
  onConfirm: (name?: string, programSlug?: string) => void
  onBack: () => void
}

/** Group slugs by tier number from tier_suggestion map */
function groupByTier(tierSuggestion: Record<string, number>): Map<number, string[]> {
  const tiers = new Map<number, string[]>()
  for (const [slug, tier] of Object.entries(tierSuggestion)) {
    if (!tiers.has(tier)) tiers.set(tier, [])
    tiers.get(tier)!.push(slug)
  }
  // Sort by tier number
  return new Map([...tiers.entries()].sort(([a], [b]) => a - b))
}

export default function DisjointAnalysisScreen({
  slugs,
  conflictReport,
  onConfirm,
  onBack,
}: DisjointAnalysisScreenProps): JSX.Element {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  const hasConflicts = conflictReport.conflicts.length > 0
  const tierGroups = useMemo(
    () => groupByTier(conflictReport.tier_suggestion),
    [conflictReport.tier_suggestion],
  )

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto py-6 px-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to selection
      </button>

      <h2 className="text-lg font-semibold text-foreground">
        Program Analysis ({slugs.length} IMPLs)
      </h2>

      {/* Section 1: Conflict Report */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {hasConflicts ? (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            )}
            Conflict Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasConflicts ? (
            <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2">
              <p className="text-xs text-green-700 dark:text-green-400">
                All IMPLs are disjoint &mdash; safe to run in parallel
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {conflictReport.conflicts.length} file conflict{conflictReport.conflicts.length !== 1 ? 's' : ''} detected &mdash; overlapping IMPLs will be placed in separate tiers
                </p>
              </div>
              <div className="space-y-1.5">
                {conflictReport.conflicts.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-3 py-2 rounded-md border border-border bg-card text-xs"
                  >
                    <FileWarning className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-foreground">{c.file}</span>
                      <span className="text-muted-foreground">
                        Overlaps: {c.impls.join(', ')}
                        {c.repos && c.repos.length > 0 && (
                          <span className="ml-1">({c.repos.join(', ')})</span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Proposed Tier Structure */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-violet-500" />
            Proposed Tier Structure
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tierGroups.size === 0 ? (
            <p className="text-xs text-muted-foreground">No tier assignments available</p>
          ) : (
            Array.from(tierGroups.entries()).map(([tierNum, tierSlugs]) => (
              <div key={tierNum} className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Tier {tierNum}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {tierSlugs.map((s) => (
                    <span
                      key={s}
                      className="px-2 py-1 rounded-md text-xs font-medium bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Section 3: Text-based Tier Diagram (dependency graph preview) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Dependency Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-1 py-2">
            {Array.from(tierGroups.entries()).map(([tierNum, tierSlugs], idx) => (
              <div key={tierNum} className="flex flex-col items-center gap-1">
                {idx > 0 && (
                  <div className="w-px h-4 bg-border" />
                )}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card">
                  <span className="text-[10px] font-medium text-muted-foreground">T{tierNum}</span>
                  <span className="text-xs text-foreground">
                    {tierSlugs.join(' , ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Confirm */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Create Program</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Program Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auto-generated"
                className="px-3 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Program Slug
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="Auto-generated"
                className="px-3 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-md text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors"
            >
              Back
            </button>
            <button
              onClick={() =>
                onConfirm(
                  name.trim() || undefined,
                  slug.trim() || undefined,
                )
              }
              className="px-4 py-2 rounded-md text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            >
              Create Program
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
