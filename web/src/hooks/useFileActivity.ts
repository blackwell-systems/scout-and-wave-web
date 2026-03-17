import { useMemo } from 'react'
import { FileActivityStatus, FileActivityEntry } from '../types/fileActivity'
import { AppWaveState } from './waveEventsReducer'

/**
 * Custom hook that derives per-file activity status from the AppWaveState.
 * Watches toolCalls on each running agent and maps file paths to their
 * current activity status.
 *
 * Status derivation logic:
 * - Start with all files from all agents' `files[]` arrays as `idle`
 * - For each agent with status `running`, scan `toolCalls` (newest first):
 *   - If `tool_name` is "Read" or "Glob" or "Grep" and input contains a file path
 *     that matches an owned file: set that file to `reading`
 *   - If `tool_name` is "Write" or "Edit" and input contains a file path
 *     that matches an owned file: set that file to `writing`
 * - For each agent with status `complete`, set all their owned files to `committed`
 * - Use `useMemo` to avoid recomputation on every render
 */
export function useFileActivity(waveState: AppWaveState): Map<string, FileActivityEntry> {
  return useMemo(() => {
    const activityMap = new Map<string, FileActivityEntry>()

    // Step 1: Initialize all files as idle
    for (const agent of waveState.agents) {
      for (const file of (agent.files ?? [])) {
        if (!activityMap.has(file)) {
          activityMap.set(file, {
            status: 'idle',
            agent: agent.agent,
            lastUpdated: Date.now(),
          })
        }
      }
    }

    // Step 2: Process complete agents first - mark their files as committed
    for (const agent of waveState.agents) {
      if (agent.status === 'complete') {
        for (const file of (agent.files ?? [])) {
          activityMap.set(file, {
            status: 'committed',
            agent: agent.agent,
            lastUpdated: Date.now(),
          })
        }
      }
    }

    // Step 3: Process running agents - scan toolCalls for active operations
    for (const agent of waveState.agents) {
      if (agent.status === 'running' && agent.toolCalls) {
        // Cap at most recent 10 tool calls for performance
        const recentCalls = agent.toolCalls.slice(0, 10)

        // Scan newest first
        for (const toolCall of recentCalls) {
          const filePath = extractFilePath(toolCall.input)
          if (!filePath) continue

          // Find which owned file this tool call refers to
          const matchedFile = (agent.files ?? []).find(f => pathsMatch(filePath, f))
          if (!matchedFile) continue

          const currentEntry = activityMap.get(matchedFile)
          if (!currentEntry) continue

          // Determine status based on tool name
          let newStatus: FileActivityStatus | null = null
          if (toolCall.tool_name === 'Read' || toolCall.tool_name === 'Glob' || toolCall.tool_name === 'Grep') {
            newStatus = 'reading'
          } else if (toolCall.tool_name === 'Write' || toolCall.tool_name === 'Edit') {
            newStatus = 'writing'
          }

          if (newStatus) {
            // Writing takes priority over reading (if already set)
            if (newStatus === 'writing' || currentEntry.status !== 'writing') {
              activityMap.set(matchedFile, {
                status: newStatus,
                agent: agent.agent,
                lastTool: toolCall.tool_name,
                lastUpdated: Date.now(),
              })
            }
          }
        }
      }
    }

    return activityMap
  }, [waveState.agents])
}

/**
 * Extract a file path from a tool call input string.
 * Simple heuristic: find the first token that looks like a file path
 * (contains `/` and ends with a file extension).
 */
function extractFilePath(input: string): string | null {
  if (!input) return null

  // Split by whitespace and newlines
  const tokens = input.split(/[\s\n]+/)

  for (const token of tokens) {
    // Look for tokens that contain `/` and end with a common file extension
    if (token.includes('/') && /\.(ts|tsx|js|jsx|go|py|java|c|cpp|h|md|json|yaml|yml|txt|css|scss|html)$/i.test(token)) {
      return token
    }
  }

  return null
}

/**
 * Check if two file paths match using suffix matching.
 * Tool inputs contain absolute paths, ownership paths are relative.
 */
function pathsMatch(toolPath: string, ownershipPath: string): boolean {
  // Exact match
  if (toolPath === ownershipPath) return true

  // Suffix match: tool path ends with ownership path
  if (toolPath.endsWith('/' + ownershipPath) || toolPath.endsWith(ownershipPath)) {
    return true
  }

  return false
}
