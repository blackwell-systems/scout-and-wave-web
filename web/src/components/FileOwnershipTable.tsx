import { FileOwnershipEntry } from '../types'
import React from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'
import { Badge } from './ui/badge'
import { getAgentColor, getAgentColorWithOpacity } from '../lib/agentColors'

interface FileOwnershipTableProps {
  fileOwnership: FileOwnershipEntry[]
  col4Name?: string
  onFileClick?: (file: string, agent: string, wave: number) => void
  renderViewButton?: (entry: FileOwnershipEntry) => React.ReactNode
}

// Wave-level colors (border wrapper + badge) - middle hierarchy
const WAVE_COLORS = {
  0: { border: 'border-gray-400', badge: 'border-gray-400 text-gray-700 dark:border-gray-600 dark:text-gray-300' },
  1: { border: 'border-green-500', badge: 'border-green-500 text-green-700 dark:border-green-600 dark:text-green-400' },
  2: { border: 'border-amber-500', badge: 'border-amber-500 text-amber-700 dark:border-amber-600 dark:text-amber-400' },
  3: { border: 'border-cyan-500', badge: 'border-cyan-500 text-cyan-700 dark:border-cyan-600 dark:text-cyan-400' },
  4: { border: 'border-rose-500', badge: 'border-rose-500 text-rose-700 dark:border-rose-600 dark:text-rose-400' },
} as const

// Repo-level colors (left border + subtle background) - outer hierarchy
const REPO_COLORS = [
  { border: 'border-l-4 border-blue-500', bg: 'bg-blue-500/[0.02] dark:bg-blue-500/[0.03]', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
  { border: 'border-l-4 border-purple-500', bg: 'bg-purple-500/[0.02] dark:bg-purple-500/[0.03]', text: 'text-purple-700 dark:text-purple-400', dot: 'bg-purple-500' },
  { border: 'border-l-4 border-teal-500', bg: 'bg-teal-500/[0.02] dark:bg-teal-500/[0.03]', text: 'text-teal-700 dark:text-teal-400', dot: 'bg-teal-500' },
  { border: 'border-l-4 border-rose-500', bg: 'bg-rose-500/[0.02] dark:bg-rose-500/[0.03]', text: 'text-rose-700 dark:text-rose-400', dot: 'bg-rose-500' },
  { border: 'border-l-4 border-orange-500', bg: 'bg-orange-500/[0.02] dark:bg-orange-500/[0.03]', text: 'text-orange-700 dark:text-orange-400', dot: 'bg-orange-500' },
] as const

function getWaveColor(wave: number) {
  if (wave in WAVE_COLORS) return WAVE_COLORS[wave as keyof typeof WAVE_COLORS]
  return WAVE_COLORS[4]
}

function getRepoColor(repoIndex: number) {
  return REPO_COLORS[repoIndex % REPO_COLORS.length]
}

export default function FileOwnershipTableNew({ fileOwnership, col4Name, onFileClick: _onFileClick, renderViewButton }: FileOwnershipTableProps): JSX.Element {
  // Build agent color map (excluding Scaffold which gets grey)
  const agents = Array.from(new Set(fileOwnership.map(e => e.agent))).sort()
  const nonScaffoldAgents = agents.filter(a => a.toLowerCase() !== 'scaffold')
  const agentColorMap = new Map(nonScaffoldAgents.map((agent) => [agent, getAgentColor(agent)]))

  const hasWaves = fileOwnership.some(e => e.wave > 0)
  const isCol4DependsOn = col4Name ? col4Name.toLowerCase().includes('depends') : false
  const col4Label = col4Name || 'Action'
  const hasCol4 = fileOwnership.some(e =>
    isCol4DependsOn
      ? e.depends_on && e.depends_on !== ''
      : e.action && e.action !== 'unknown'
  )
  // Check if we have multiple repos
  const repos = Array.from(new Set(fileOwnership.map(e => e.repo || '').filter(r => r !== '')))
  const hasMultipleRepos = repos.length > 1
  const hasRepo = hasMultipleRepos // Only show Repo column if multiple repos

  const sorted = [...fileOwnership].sort((a, b) => {
    const isAScaffold = a.agent.toLowerCase() === 'scaffold'
    const isBScaffold = b.agent.toLowerCase() === 'scaffold'
    if (isAScaffold && !isBScaffold) return -1
    if (!isAScaffold && isBScaffold) return 1

    const waveA = a.wave || 0
    const waveB = b.wave || 0
    if (waveA !== waveB) return waveA - waveB

    if (a.agent < b.agent) return -1
    if (a.agent > b.agent) return 1
    return 0
  })


  // Group by repo first (if multi-repo), then by wave
  const groupedByRepo: { repo: string; waveGroups: { wave: number; entries: FileOwnershipEntry[] }[] }[] = []

  if (hasMultipleRepos) {
    // Group by repo
    repos.forEach(repo => {
      const repoEntries = sorted.filter(e => (e.repo || '') === repo)

      // Within each repo, group by wave
      const waveGroups: { wave: number; entries: FileOwnershipEntry[] }[] = []
      let currentWave = -1
      let currentGroup: FileOwnershipEntry[] = []

      repoEntries.forEach(entry => {
        const wave = entry.wave || 0
        if (wave !== currentWave) {
          if (currentGroup.length > 0) {
            waveGroups.push({ wave: currentWave, entries: currentGroup })
          }
          currentWave = wave
          currentGroup = [entry]
        } else {
          currentGroup.push(entry)
        }
      })
      if (currentGroup.length > 0) {
        waveGroups.push({ wave: currentWave, entries: currentGroup })
      }

      groupedByRepo.push({ repo, waveGroups })
    })
  } else {
    // Single repo: just group by wave (existing behavior)
    const waveGroups: { wave: number; entries: FileOwnershipEntry[] }[] = []
    let currentWave = -1
    let currentGroup: FileOwnershipEntry[] = []

    sorted.forEach(entry => {
      const wave = entry.wave || 0
      if (wave !== currentWave) {
        if (currentGroup.length > 0) {
          waveGroups.push({ wave: currentWave, entries: currentGroup })
        }
        currentWave = wave
        currentGroup = [entry]
      } else {
        currentGroup.push(entry)
      }
    })
    if (currentGroup.length > 0) {
      waveGroups.push({ wave: currentWave, entries: currentGroup })
    }

    groupedByRepo.push({ repo: '', waveGroups })
  }

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-3">File Ownership</h2>
      <div className="space-y-6">
        {groupedByRepo.map((repoGroup, repoIdx) => {
          const repoColor = getRepoColor(repoIdx)
          const showRepoHeader = hasMultipleRepos && repoGroup.repo

          return (
            <div key={repoIdx} className={`${showRepoHeader ? `${repoColor.border} ${repoColor.bg} pl-4 pb-4 rounded-r-lg` : ''}`}>
              {showRepoHeader && (
                <div className="flex items-center gap-2 mb-3 pt-3 -ml-1">
                  <div className={`w-2 h-2 rounded-full ${repoColor.dot}`}></div>
                  <h3 className={`font-semibold text-sm ${repoColor.text}`}>
                    {repoGroup.repo}
                  </h3>
                </div>
              )}
              <div className="space-y-4">
                {repoGroup.waveGroups.map((group, groupIdx) => {
                  const waveColor = getWaveColor(group.wave)
                  const isScaffoldGroup = group.wave === 0

                  return (
                    <div key={groupIdx} className={`rounded-lg border-2 ${waveColor.border} overflow-hidden`}>
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-[50%]">File</TableHead>
                            <TableHead>Agent</TableHead>
                            {hasWaves && <TableHead className={`w-[80px] ${isScaffoldGroup ? 'opacity-0' : ''}`}>Wave</TableHead>}
                            {hasCol4 && <TableHead>{col4Label}</TableHead>}
                            {hasRepo && <TableHead>Repo</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.entries.map((entry, idx) => {
                            const isScaffold = entry.agent.toLowerCase() === 'scaffold'
                            const agentColor = isScaffold
                              ? '#6b7280' // gray fallback for Scaffold
                              : agentColorMap.get(entry.agent) ?? '#6b7280'
                            const bgColor = getAgentColorWithOpacity(isScaffold ? 'scaffold' : entry.agent, 0.15)
                            return (
                              <TableRow
                                key={idx}
                                style={{
                                  backgroundColor: bgColor,
                                  color: agentColor,
                                }}
                              >
                                <TableCell className="font-mono text-xs">
                                  <span className="inline-flex items-center gap-0.5">
                                    {entry.file}
                                    {renderViewButton ? renderViewButton(entry) : null}
                                  </span>
                                </TableCell>
                                <TableCell className="font-medium">{entry.agent}</TableCell>
                                {hasWaves && (
                                  <TableCell>
                                    {!isScaffold && (
                                      <Badge variant="outline" className={`${waveColor.badge} font-mono text-[10px]`}>
                                        {entry.wave}
                                      </Badge>
                                    )}
                                  </TableCell>
                                )}
                                {hasCol4 && (
                                  <TableCell className="capitalize text-sm opacity-70">
                                    {isCol4DependsOn ? (entry.depends_on || '') : (entry.action || '')}
                                  </TableCell>
                                )}
                                {hasRepo && (
                                  <TableCell className="text-sm opacity-70">
                                    {entry.repo || ""}
                                  </TableCell>
                                )}
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
