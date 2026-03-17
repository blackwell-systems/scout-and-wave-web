import { IMPLDocResponse, IMPLListEntry, WorktreeListResponse, WorktreeBatchDeleteRequest, WorktreeBatchDeleteResponse, FileDiffResponse, SAWConfig, ChatMessage, AgentContextResponse, ScoutContext, InterruptedSession } from './types'

export async function listImpls(): Promise<IMPLListEntry[]> {
  const response = await fetch('/api/impl')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<IMPLListEntry[]>
}

export async function fetchImpl(slug: string): Promise<IMPLDocResponse> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<IMPLDocResponse>
}

export async function approveImpl(slug: string): Promise<void> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}/approve`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function rejectImpl(slug: string): Promise<void> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}/reject`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function startWave(slug: string): Promise<void> {
  const response = await fetch(`/api/wave/${encodeURIComponent(slug)}/start`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function runScout(feature: string, repo?: string, context?: ScoutContext): Promise<{ runId: string }> {
  const r = await fetch('/api/scout/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feature,
      repo,
      ...(context && {
        context_files: context.files,
        context_notes: context.notes,
        context_constraints: context.constraints,
      }),
    }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  return { runId: data.run_id }
}

export function subscribeScoutEvents(runId: string): EventSource {
  return new EventSource(`/api/scout/${encodeURIComponent(runId)}/events`)
}

export async function proceedWaveGate(slug: string): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/gate/proceed`, { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function fetchImplRaw(slug: string): Promise<string> {
  const r = await fetch(`/api/impl/${encodeURIComponent(slug)}/raw`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

export async function deleteImpl(slug: string): Promise<void> {
  const r = await fetch(`/api/impl/${encodeURIComponent(slug)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function cancelScout(runId: string): Promise<void> {
  await fetch(`/api/scout/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
}

export async function cancelRevise(slug: string, runId: string): Promise<void> {
  await fetch(`/api/impl/${encodeURIComponent(slug)}/revise/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
}

export async function mergeWave(slug: string, wave: number): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function mergeAbort(slug: string): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/merge-abort`, {
    method: 'POST',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function runWaveTests(slug: string, wave: number): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function resolveConflicts(slug: string, wave: number): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/resolve-conflicts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function saveImplRaw(slug: string, content: string): Promise<void> {
  const r = await fetch(`/api/impl/${encodeURIComponent(slug)}/raw`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function runImplRevise(slug: string, feedback: string): Promise<{ runId: string }> {
  const r = await fetch(`/api/impl/${encodeURIComponent(slug)}/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  return { runId: data.run_id }
}

export function subscribeReviseEvents(slug: string, runId: string): EventSource {
  return new EventSource(`/api/impl/${encodeURIComponent(slug)}/revise/${encodeURIComponent(runId)}/events`)
}

export async function rerunAgent(slug: string, wave: number, agentLetter: string, opts?: { scopeHint?: string }): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/agent/${encodeURIComponent(agentLetter)}/rerun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wave,
      ...(opts?.scopeHint ? { scope_hint: opts.scopeHint } : {}),
    }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function retryFinalize(slug: string, wave: number): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function fixBuild(slug: string, wave: number, errorLog: string, gateType: string): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/fix-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave, error_log: errorLog, gate_type: gateType }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

// Disk-based wave status (survives server restarts)
export interface DiskAgentStatus {
  agent: string
  wave: number
  status: string
  branch?: string
  commit?: string
  files?: string[]
  failure_type?: string
  message?: string
}

export interface DiskWaveStatus {
  slug: string
  current_wave: number
  total_waves: number
  scaffold_status: string
  agents: DiskAgentStatus[]
  waves_merged?: number[]
}

export async function fetchDiskWaveStatus(slug: string): Promise<DiskWaveStatus> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/disk-status`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// Worktree manager
export async function listWorktrees(slug: string): Promise<WorktreeListResponse> {
  const r = await fetch(`/api/impl/${slug}/worktrees`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function deleteWorktree(slug: string, branch: string): Promise<void> {
  const r = await fetch(`/api/impl/${slug}/worktrees/${encodeURIComponent(branch)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

export async function batchDeleteWorktrees(slug: string, req: WorktreeBatchDeleteRequest): Promise<WorktreeBatchDeleteResponse> {
  const r = await fetch(`/api/impl/${encodeURIComponent(slug)}/worktrees/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// File diff viewer
export async function fetchFileDiff(slug: string, agent: string, wave: number, file: string): Promise<FileDiffResponse> {
  const params = new URLSearchParams({ wave: String(wave), file })
  const r = await fetch(`/api/impl/${slug}/diff/${agent}?${params}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// Settings
export async function getConfig(): Promise<SAWConfig> {
  const r = await fetch(`/api/config`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return { ...data, repos: data.repos ?? [] }
}

export interface BrowseResult {
  path: string
  parent: string
  entries: Array<{ name: string; is_dir: boolean }>
}

export async function browse(path?: string): Promise<BrowseResult> {
  const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : `/api/browse`
  const r = await fetch(url)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

/** Opens the OS-native folder picker dialog (macOS only).
 *  Returns the selected path, null if cancelled, or throws if unsupported. */
export async function browseNative(prompt?: string): Promise<string | null> {
  const url = prompt ? `/api/browse/native?prompt=${encodeURIComponent(prompt)}` : `/api/browse/native`
  const r = await fetch(url)
  if (r.status === 204) return null        // user cancelled
  if (r.status === 501) throw new Error('unsupported')  // non-macOS
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json() as { path: string }
  return data.path
}

export async function saveConfig(config: SAWConfig): Promise<void> {
  const r = await fetch(`/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!r.ok) throw new Error(await r.text())
}

// CONTEXT.md viewer
export async function getContext(): Promise<string> {
  const r = await fetch(`/api/context`)
  if (r.status === 404) return ''
  if (!r.ok) throw new Error(await r.text())
  return r.text()
}

export async function putContext(content: string): Promise<void> {
  const r = await fetch(`/api/context`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  })
  if (!r.ok) throw new Error(await r.text())
}

// Chat with Claude
export async function startImplChat(slug: string, message: string, history: ChatMessage[]): Promise<{ runId: string }> {
  const r = await fetch(`/api/impl/${slug}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return { runId: data.run_id }
}

export function subscribeChatEvents(slug: string, runId: string): EventSource {
  return new EventSource(`/api/impl/${slug}/chat/${runId}/events`)
}

// Scaffold rerun
export async function rerunScaffold(slug: string): Promise<void> {
  const r = await fetch(`/api/impl/${slug}/scaffold/rerun`, { method: 'POST' })
  if (!r.ok) throw new Error(await r.text())
}

// Per-agent context payload
export async function fetchAgentContext(slug: string, agent: string): Promise<AgentContextResponse> {
  const r = await fetch(`/api/impl/${slug}/agent/${agent}/context`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// Interrupted session detection (resume)
export async function fetchInterruptedSessions(): Promise<InterruptedSession[]> {
  const r = await fetch('/api/sessions/interrupted')
  if (!r.ok) return [] // non-fatal: don't block the UI
  return r.json() as Promise<InterruptedSession[]>
}

// File browser API
import { FileTreeResponse, FileContentResponse, GitStatusResponse } from './types/filebrowser'

export async function fetchFileTree(repo: string, path?: string): Promise<FileTreeResponse> {
  const params = new URLSearchParams({ repo })
  if (path !== undefined) params.set('path', path)
  const r = await fetch(`/api/files/tree?${params}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<FileTreeResponse>
}

export async function fetchFileContent(repo: string, path: string): Promise<FileContentResponse> {
  const params = new URLSearchParams({ repo, path })
  const r = await fetch(`/api/files/read?${params}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<FileContentResponse>
}

export async function fetchFileDiffForBrowser(repo: string, path: string): Promise<{ repo: string; path: string; diff: string }> {
  const params = new URLSearchParams({ repo, path })
  const r = await fetch(`/api/files/diff?${params}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<{ repo: string; path: string; diff: string }>
}

export async function fetchGitStatus(repo: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ repo })
  const r = await fetch(`/api/files/status?${params}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<GitStatusResponse>
}

// Pipeline recovery controls
export async function retryStep(slug: string, step: string, wave: number): Promise<void> {
  const res = await fetch(`/api/wave/${encodeURIComponent(slug)}/step/${step}/retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function skipStep(slug: string, step: string, wave: number, reason: string): Promise<void> {
  const res = await fetch(`/api/wave/${encodeURIComponent(slug)}/step/${step}/skip`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave, reason }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function forceMarkComplete(slug: string): Promise<void> {
  const res = await fetch(`/api/wave/${encodeURIComponent(slug)}/mark-complete`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
}
