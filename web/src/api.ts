// @deprecated — Use sawClient from lib/apiClient.ts instead.
// This file re-exports all functions as thin wrappers over the new SawClient
// so existing imports continue to work without breaking anything.

import { sawClient } from './lib/apiClient'
import type { IMPLDocResponse, IMPLListEntry, WorktreeListResponse, WorktreeBatchDeleteRequest, WorktreeBatchDeleteResponse, FileDiffResponse, SAWConfig, ChatMessage, AgentContextResponse, ScoutContext, InterruptedSession } from './types'
import type { FileTreeResponse, FileContentResponse, GitStatusResponse, FileResolveResponse } from './types/filebrowser'

// Re-export types that consumers may import from this file
export type { BrowseResult, DiskAgentStatus, DiskWaveStatus } from './lib/apiClient'

export async function listImpls(): Promise<IMPLListEntry[]> {
  return sawClient.impl.list()
}

export async function fetchImpl(slug: string): Promise<IMPLDocResponse> {
  return sawClient.impl.get(slug)
}

export async function approveImpl(slug: string): Promise<void> {
  return sawClient.impl.approve(slug)
}

export async function rejectImpl(slug: string): Promise<void> {
  return sawClient.impl.reject(slug)
}

export async function startWave(slug: string): Promise<void> {
  return sawClient.wave.start(slug)
}

export async function runScout(feature: string, repo?: string, context?: ScoutContext): Promise<{ runId: string }> {
  return sawClient.scout.run(feature, repo, context)
}

export function subscribeScoutEvents(runId: string): EventSource {
  return sawClient.scout.subscribeEvents(runId)
}

export async function proceedWaveGate(slug: string): Promise<void> {
  return sawClient.wave.proceedGate(slug)
}

export async function fetchImplRaw(slug: string): Promise<string> {
  return sawClient.impl.getRaw(slug)
}

export async function deleteImpl(slug: string): Promise<void> {
  return sawClient.impl.delete(slug)
}

export async function cancelScout(runId: string): Promise<void> {
  return sawClient.scout.cancel(runId)
}

// cancelRevise has no direct SawClient mapping; keep inline fetch for now
export async function cancelRevise(slug: string, runId: string): Promise<void> {
  await fetch(`/api/impl/${encodeURIComponent(slug)}/revise/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
}

export async function mergeWave(slug: string, wave: number): Promise<void> {
  return sawClient.wave.mergeWave(slug, wave)
}

export async function mergeAbort(slug: string): Promise<void> {
  return sawClient.wave.mergeAbort(slug)
}

export async function runWaveTests(slug: string, wave: number): Promise<void> {
  return sawClient.wave.runTests(slug, wave)
}

export async function resolveConflicts(slug: string, wave: number): Promise<void> {
  return sawClient.wave.resolveConflicts(slug, wave)
}

export async function saveImplRaw(slug: string, content: string): Promise<void> {
  return sawClient.impl.saveRaw(slug, content)
}

export async function runImplRevise(slug: string, feedback: string): Promise<{ runId: string }> {
  return sawClient.impl.revise(slug, feedback)
}

export function subscribeReviseEvents(slug: string, runId: string): EventSource {
  return sawClient.impl.subscribeReviseEvents(slug, runId)
}

export async function rerunAgent(slug: string, wave: number, agentLetter: string, opts?: { scopeHint?: string }): Promise<void> {
  return sawClient.wave.rerunAgent(slug, wave, agentLetter, opts)
}

export async function retryFinalize(slug: string, wave: number): Promise<void> {
  return sawClient.wave.retryFinalize(slug, wave)
}

export async function fixBuild(slug: string, wave: number, errorLog: string, gateType: string): Promise<void> {
  return sawClient.wave.fixBuild(slug, wave, errorLog, gateType)
}

// Disk-based wave status (survives server restarts)
export async function fetchDiskWaveStatus(slug: string): Promise<import('./lib/apiClient').DiskWaveStatus> {
  return sawClient.wave.diskStatus(slug)
}

// Worktree manager
export async function listWorktrees(slug: string): Promise<WorktreeListResponse> {
  return sawClient.impl.worktrees.list(slug)
}

export async function deleteWorktree(slug: string, branch: string): Promise<void> {
  return sawClient.impl.worktrees.delete(slug, branch)
}

export async function batchDeleteWorktrees(slug: string, req: WorktreeBatchDeleteRequest): Promise<WorktreeBatchDeleteResponse> {
  return sawClient.impl.worktrees.batchDelete(slug, req)
}

// File diff viewer
export async function fetchFileDiff(slug: string, agent: string, wave: number, file: string): Promise<FileDiffResponse> {
  return sawClient.impl.diff(slug, agent, wave, file)
}

// Settings
export async function getConfig(): Promise<SAWConfig> {
  return sawClient.config.get()
}

export async function browse(path?: string): Promise<import('./lib/apiClient').BrowseResult> {
  return sawClient.config.browse(path)
}

/** Opens the OS-native folder picker dialog (macOS only).
 *  Returns the selected path, null if cancelled, or throws if unsupported. */
export async function browseNative(prompt?: string): Promise<string | null> {
  return sawClient.config.browseNative(prompt)
}

export async function saveConfig(config: SAWConfig): Promise<void> {
  return sawClient.config.save(config)
}

// CONTEXT.md viewer
export async function getContext(): Promise<string> {
  return sawClient.config.context.get()
}

export async function putContext(content: string): Promise<void> {
  return sawClient.config.context.put(content)
}

// Chat with Claude
export async function startImplChat(slug: string, message: string, history: ChatMessage[]): Promise<{ runId: string }> {
  return sawClient.impl.chat(slug, message, history)
}

export function subscribeChatEvents(slug: string, runId: string): EventSource {
  return sawClient.impl.subscribeChatEvents(slug, runId)
}

// Scaffold rerun
export async function rerunScaffold(slug: string): Promise<void> {
  return sawClient.scout.rerunScaffold(slug)
}

// Per-agent context payload
export async function fetchAgentContext(slug: string, agent: string): Promise<AgentContextResponse> {
  return sawClient.impl.fetchAgentContext(slug, agent)
}

// Interrupted session detection (resume)
export async function fetchInterruptedSessions(): Promise<InterruptedSession[]> {
  return sawClient.wave.interruptedSessions()
}

// Resume execution for an interrupted session.
// Unlike other api.ts functions, this does NOT throw on failure.
// It returns { success: false, error: message } so callers can handle
// errors inline without try/catch in the render tree.
export async function resumeExecution(slug: string): Promise<{ success: boolean; error?: string }> {
  return sawClient.wave.resumeExecution(slug)
}

// File browser API
export async function fetchFileTree(repo: string, path?: string): Promise<FileTreeResponse> {
  return sawClient.files.tree(repo, path)
}

export async function fetchFileContent(repo: string, path: string): Promise<FileContentResponse> {
  return sawClient.files.read(repo, path)
}

export async function fetchFileDiffForBrowser(repo: string, path: string): Promise<{ repo: string; path: string; diff: string }> {
  return sawClient.files.diff(repo, path)
}

export async function fetchGitStatus(repo: string): Promise<GitStatusResponse> {
  return sawClient.files.gitStatus(repo)
}

export async function fetchResolveFile(path: string): Promise<FileResolveResponse> {
  return sawClient.files.resolve(path)
}

// Pipeline recovery controls
export async function retryStep(slug: string, step: string, wave: number): Promise<void> {
  return sawClient.wave.retryStep(slug, step, wave)
}

export async function skipStep(slug: string, step: string, wave: number, reason: string): Promise<void> {
  return sawClient.wave.skipStep(slug, step, wave, reason)
}

export async function forceMarkComplete(slug: string): Promise<void> {
  return sawClient.wave.forceMarkComplete(slug)
}
