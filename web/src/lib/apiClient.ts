/**
 * Unified API client for the SAW web application.
 *
 * Provides a structured, namespaced interface (`SawClient`) that wraps all
 * existing fetch() calls from api.ts, autonomyApi.ts, and programApi.ts.
 * The transport layer can be swapped (e.g. Wails native calls) by providing
 * a different implementation of `SawClient`.
 *
 * Created by Wave 1 Agent A (react-refactor).
 */

import type {
  IMPLListEntry,
  IMPLDocResponse,
  WorktreeListResponse,
  WorktreeBatchDeleteRequest,
  WorktreeBatchDeleteResponse,
  FileDiffResponse,
  SAWConfig,
  ChatMessage,
  AgentContextResponse,
  ScoutContext,
  InterruptedSession,
  CriticResult,
  CriticFixRequest,
  AutoFixCriticResponse,
} from '../types'

import type {
  PipelineResponse,
  QueueItem,
  AddQueueItemRequest,
  AutonomyConfig,
  DaemonState,
} from '../types/autonomy'

import type {
  ProgramDiscovery,
  ProgramStatus,
  TierStatus,
  ContractStatus,
  ConflictReport,
  GenerateProgramResult,
} from '../types/program'

import type {
  FileTreeResponse,
  FileContentResponse,
  GitStatusResponse,
  FileResolveResponse,
} from '../types/filebrowser'

// Re-export types that api.ts currently exports so consumers can migrate
// their imports to this module without breakage.
// DiskAgentStatus, DiskWaveStatus, and BrowseResult are defined below
// alongside the SawClient interface.

// ─── Interview / Validation / Import types ───────────────────────────────────

export interface IntegrationGap {
  type: string
  file?: string
  symbol?: string
  reason: string
  severity: string
}

export interface WiringGap {
  symbol: string
  defined_in: string
  must_be_called_from: string
  reason: string
}

export interface ValidateIntegrationResponse {
  valid: boolean
  wave: number
  gaps: IntegrationGap[]
}

export interface ValidateWiringResponse {
  valid: boolean
  gaps: WiringGap[]
}

export interface ImportIMPLsRequest {
  program_slug: string
  impl_paths?: string[]
  tier_map?: Record<string, number>
  discover?: boolean
  repo_dir?: string
}

export interface ImportIMPLsResponse {
  program_path: string
  imported: string[]
  skipped: string[]
}

// ─── SawClient interface ────────────────────────────────────────────────────

export interface SawClient {
  impl: {
    list(): Promise<IMPLListEntry[]>
    get(slug: string): Promise<IMPLDocResponse>
    getRaw(slug: string): Promise<string>
    saveRaw(slug: string, content: string): Promise<void>
    approve(slug: string): Promise<void>
    reject(slug: string): Promise<void>
    delete(slug: string): Promise<void>
    revise(slug: string, feedback: string): Promise<{ runId: string }>
    subscribeReviseEvents(slug: string, runId: string): EventSource
    chat(slug: string, message: string, history: ChatMessage[]): Promise<{ runId: string }>
    subscribeChatEvents(slug: string, runId: string): EventSource
    criticReview(slug: string): Promise<CriticResult | null>
    runCritic(slug: string): Promise<void>
    applyCriticFix(slug: string, fix: CriticFixRequest): Promise<CriticResult>
    autoFixCritic(slug: string, dryRun?: boolean): Promise<AutoFixCriticResponse>
    fetchAgentContext(slug: string, agent: string): Promise<AgentContextResponse>
    worktrees: {
      list(slug: string): Promise<WorktreeListResponse>
      delete(slug: string, branch: string): Promise<void>
      batchDelete(slug: string, req: WorktreeBatchDeleteRequest): Promise<WorktreeBatchDeleteResponse>
    }
    diff(slug: string, agent: string, wave: number, file: string): Promise<FileDiffResponse>
    amend(slug: string, body: object): Promise<any>
    manifest(slug: string): Promise<any>
    validateManifest(slug: string): Promise<{ valid: boolean; errors: any[] }>
    validateIntegration(slug: string, wave: number): Promise<ValidateIntegrationResponse>
    validateWiring(slug: string): Promise<ValidateWiringResponse>
    importImpls(req: ImportIMPLsRequest): Promise<ImportIMPLsResponse>
  }
  interview: {
    start(description: string, opts?: { maxQuestions?: number; projectPath?: string }): Promise<{ runId: string }>
    subscribeEvents(runId: string): EventSource
    answer(runId: string, answer: string): Promise<void>
  }
  wave: {
    start(slug: string): Promise<void>
    mergeWave(slug: string, wave: number): Promise<void>
    mergeAbort(slug: string): Promise<void>
    runTests(slug: string, wave: number): Promise<void>
    resolveConflicts(slug: string, wave: number): Promise<void>
    rerunAgent(slug: string, wave: number, agent: string, opts?: { scopeHint?: string }): Promise<void>
    retryFinalize(slug: string, wave: number): Promise<void>
    fixBuild(slug: string, wave: number, errorLog: string, gateType: string): Promise<void>
    proceedGate(slug: string): Promise<void>
    diskStatus(slug: string): Promise<DiskWaveStatus>
    subscribeEvents(slug: string): EventSource
    retryStep(slug: string, step: string, wave: number): Promise<void>
    skipStep(slug: string, step: string, wave: number, reason: string): Promise<void>
    forceMarkComplete(slug: string): Promise<void>
    resumeExecution(slug: string): Promise<{ success: boolean; error?: string }>
    interruptedSessions(): Promise<InterruptedSession[]>
  }
  scout: {
    run(feature: string, repo?: string, context?: ScoutContext): Promise<{ runId: string }>
    subscribeEvents(runId: string): EventSource
    cancel(runId: string): Promise<void>
    rerunScaffold(slug: string): Promise<void>
  }
  config: {
    get(): Promise<SAWConfig>
    save(config: SAWConfig): Promise<void>
    browse(path?: string): Promise<BrowseResult>
    browseNative(prompt?: string): Promise<string | null>
    validateRepo(path: string): Promise<{ valid: boolean; error?: string; error_code?: string }>
    context: {
      get(): Promise<string>
      put(content: string): Promise<void>
    }
  }
  autonomy: {
    fetchPipeline(): Promise<PipelineResponse>
    fetchQueue(): Promise<QueueItem[]>
    addQueueItem(req: AddQueueItemRequest): Promise<QueueItem>
    deleteQueueItem(slug: string): Promise<void>
    updateQueuePriority(slug: string, priority: number): Promise<void>
    fetchConfig(): Promise<AutonomyConfig>
    saveConfig(config: AutonomyConfig): Promise<void>
    startDaemon(): Promise<DaemonState>
    stopDaemon(): Promise<void>
    fetchDaemonStatus(): Promise<DaemonState>
    subscribeDaemonEvents(): EventSource
  }
  program: {
    list(): Promise<ProgramDiscovery[]>
    status(slug: string): Promise<ProgramStatus>
    tierStatus(slug: string, tier: number): Promise<TierStatus>
    executeTier(slug: string, tier: number, auto?: boolean): Promise<void>
    contracts(slug: string): Promise<ContractStatus[]>
    replan(slug: string): Promise<void>
    runPlanner(description: string, repo?: string): Promise<{ runId: string }>
    subscribePlannerEvents(runId: string): EventSource
    cancelPlanner(runId: string): Promise<void>
    analyzeImpls(slugs: string[], repo?: string): Promise<ConflictReport>
    createFromImpls(slugs: string[], name?: string, programSlug?: string, repo?: string): Promise<GenerateProgramResult>
  }
  notifications: {
    getPreferences(): Promise<any>
    savePreferences(prefs: any): Promise<void>
  }
  bootstrap: {
    run(description: string, repo?: string): Promise<{ run_id: string }>
  }
  files: {
    tree(repo: string, path?: string): Promise<FileTreeResponse>
    read(repo: string, path: string): Promise<FileContentResponse>
    diff(repo: string, path: string): Promise<{ repo: string; path: string; diff: string }>
    gitStatus(repo: string): Promise<GitStatusResponse>
    resolve(path: string): Promise<FileResolveResponse>
  }
}

// Types re-exported from api.ts (defined here to avoid circular deps)
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

export interface BrowseResult {
  path: string
  parent: string
  entries: Array<{ name: string; is_dir: boolean }>
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function enc(s: string): string {
  return encodeURIComponent(s)
}

async function check(r: Response): Promise<void> {
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  }
}

async function checkShort(r: Response): Promise<void> {
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`)
  }
}

// ─── HTTP transport implementation ──────────────────────────────────────────

export function createHttpClient(): SawClient {
  return {
    // ── impl namespace ────────────────────────────────────────────────────
    impl: {
      async list(): Promise<IMPLListEntry[]> {
        const r = await fetch('/api/impl')
        await check(r)
        return r.json() as Promise<IMPLListEntry[]>
      },

      async get(slug: string): Promise<IMPLDocResponse> {
        const r = await fetch(`/api/impl/${enc(slug)}`)
        await check(r)
        return r.json() as Promise<IMPLDocResponse>
      },

      async getRaw(slug: string): Promise<string> {
        const r = await fetch(`/api/impl/${enc(slug)}/raw`)
        await checkShort(r)
        return r.text()
      },

      async saveRaw(slug: string, content: string): Promise<void> {
        const r = await fetch(`/api/impl/${enc(slug)}/raw`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: content,
        })
        await checkShort(r)
      },

      async approve(slug: string): Promise<void> {
        const r = await fetch(`/api/impl/${enc(slug)}/approve`, { method: 'POST' })
        await check(r)
      },

      async reject(slug: string): Promise<void> {
        const r = await fetch(`/api/impl/${enc(slug)}/reject`, { method: 'POST' })
        await check(r)
      },

      async delete(slug: string): Promise<void> {
        const r = await fetch(`/api/impl/${enc(slug)}`, { method: 'DELETE' })
        await checkShort(r)
      },

      async revise(slug: string, feedback: string): Promise<{ runId: string }> {
        const r = await fetch(`/api/impl/${enc(slug)}/revise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback }),
        })
        await checkShort(r)
        const data = await r.json()
        return { runId: data.run_id }
      },

      subscribeReviseEvents(slug: string, runId: string): EventSource {
        return new EventSource(`/api/impl/${enc(slug)}/revise/${enc(runId)}/events`)
      },

      async chat(slug: string, message: string, history: ChatMessage[]): Promise<{ runId: string }> {
        const r = await fetch(`/api/impl/${slug}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history }),
        })
        await check(r)
        const data = await r.json()
        return { runId: data.run_id }
      },

      subscribeChatEvents(slug: string, runId: string): EventSource {
        return new EventSource(`/api/impl/${slug}/chat/${runId}/events`)
      },

      async criticReview(slug: string): Promise<CriticResult | null> {
        const r = await fetch(`/api/impl/${enc(slug)}/critic-review`)
        if (r.status === 404) return null
        await check(r)
        return r.json() as Promise<CriticResult>
      },

      async runCritic(slug: string): Promise<void> {
        const r = await fetch(`/api/impl/${enc(slug)}/run-critic`, { method: 'POST' })
        await check(r)
      },

      async applyCriticFix(slug: string, fix: CriticFixRequest): Promise<CriticResult> {
        const r = await fetch(`/api/impl/${enc(slug)}/fix-critic`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fix),
        })
        await check(r)
        return r.json() as Promise<CriticResult>
      },

      async autoFixCritic(slug: string, dryRun?: boolean): Promise<AutoFixCriticResponse> {
        const r = await fetch(`/api/impl/${enc(slug)}/auto-fix-critic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dry_run: dryRun }),
        })
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<AutoFixCriticResponse>
      },

      async fetchAgentContext(slug: string, agent: string): Promise<AgentContextResponse> {
        const r = await fetch(`/api/impl/${slug}/agent/${agent}/context`)
        await check(r)
        return r.json() as Promise<AgentContextResponse>
      },

      worktrees: {
        async list(slug: string): Promise<WorktreeListResponse> {
          const r = await fetch(`/api/impl/${slug}/worktrees`)
          if (!r.ok) throw new Error(await r.text())
          return r.json() as Promise<WorktreeListResponse>
        },

        async delete(slug: string, branch: string): Promise<void> {
          const r = await fetch(`/api/impl/${slug}/worktrees/${enc(branch)}`, { method: 'DELETE' })
          if (!r.ok) throw new Error(await r.text())
        },

        async batchDelete(slug: string, req: WorktreeBatchDeleteRequest): Promise<WorktreeBatchDeleteResponse> {
          const r = await fetch(`/api/impl/${enc(slug)}/worktrees/cleanup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
          })
          if (!r.ok) throw new Error(await r.text())
          return r.json() as Promise<WorktreeBatchDeleteResponse>
        },
      },

      async diff(slug: string, agent: string, wave: number, file: string): Promise<FileDiffResponse> {
        const params = new URLSearchParams({ wave: String(wave), file })
        const r = await fetch(`/api/impl/${slug}/diff/${agent}?${params}`)
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<FileDiffResponse>
      },

      async amend(slug: string, body: object): Promise<any> {
        const r = await fetch(`/api/impl/${enc(slug)}/amend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        return r.json()
      },

      async manifest(slug: string): Promise<any> {
        const r = await fetch(`/api/impl/${enc(slug)}/manifest`)
        if (!r.ok) throw new Error(`Failed to load manifest: ${r.statusText}`)
        return r.json()
      },

      async validateManifest(slug: string): Promise<{ valid: boolean; errors: any[] }> {
        const r = await fetch(`/api/manifest/${enc(slug)}/validate`, { method: 'POST' })
        if (!r.ok) throw new Error(`Failed to validate manifest: ${r.statusText}`)
        return r.json()
      },

      async validateIntegration(slug: string, wave: number): Promise<ValidateIntegrationResponse> {
        const r = await fetch(`/api/impl/${enc(slug)}/validate-integration?wave=${wave}`)
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<ValidateIntegrationResponse>
      },

      async validateWiring(slug: string): Promise<ValidateWiringResponse> {
        const r = await fetch(`/api/impl/${enc(slug)}/validate-wiring`)
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<ValidateWiringResponse>
      },

      async importImpls(req: ImportIMPLsRequest): Promise<ImportIMPLsResponse> {
        const r = await fetch('/api/impl/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        })
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<ImportIMPLsResponse>
      },
    },

    // ── interview namespace ───────────────────────────────────────────────
    interview: {
      async start(description: string, opts?: { maxQuestions?: number; projectPath?: string }): Promise<{ runId: string }> {
        const r = await fetch('/api/interview/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description,
            ...(opts?.maxQuestions !== undefined ? { max_questions: opts.maxQuestions } : {}),
            ...(opts?.projectPath !== undefined ? { project_path: opts.projectPath } : {}),
          }),
        })
        if (!r.ok) throw new Error(await r.text())
        const data = await r.json() as { run_id: string }
        return { runId: data.run_id }
      },

      subscribeEvents(runId: string): EventSource {
        return new EventSource(`/api/interview/${enc(runId)}/events`)
      },

      async answer(runId: string, answer: string): Promise<void> {
        const r = await fetch(`/api/interview/${enc(runId)}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer }),
        })
        if (!r.ok) throw new Error(await r.text())
      },
    },

    // ── wave namespace ────────────────────────────────────────────────────
    wave: {
      async start(slug: string): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/start`, { method: 'POST' })
        await check(r)
      },

      async mergeWave(slug: string, wave: number): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave }),
        })
        await check(r)
      },

      async mergeAbort(slug: string): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/merge-abort`, { method: 'POST' })
        await check(r)
      },

      async runTests(slug: string, wave: number): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave }),
        })
        await check(r)
      },

      async resolveConflicts(slug: string, wave: number): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/resolve-conflicts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave }),
        })
        await check(r)
      },

      async rerunAgent(slug: string, wave: number, agent: string, opts?: { scopeHint?: string }): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/agent/${enc(agent)}/rerun`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wave,
            ...(opts?.scopeHint ? { scope_hint: opts.scopeHint } : {}),
          }),
        })
        await checkShort(r)
      },

      async retryFinalize(slug: string, wave: number): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave }),
        })
        await checkShort(r)
      },

      async fixBuild(slug: string, wave: number, errorLog: string, gateType: string): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/fix-build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave, error_log: errorLog, gate_type: gateType }),
        })
        await checkShort(r)
      },

      async proceedGate(slug: string): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/gate/proceed`, { method: 'POST' })
        await checkShort(r)
      },

      async diskStatus(slug: string): Promise<DiskWaveStatus> {
        const r = await fetch(`/api/wave/${enc(slug)}/disk-status`)
        await checkShort(r)
        return r.json() as Promise<DiskWaveStatus>
      },

      subscribeEvents(slug: string): EventSource {
        return new EventSource(`/api/wave/${enc(slug)}/events`)
      },

      async retryStep(slug: string, step: string, wave: number): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/step/${step}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave }),
        })
        if (!r.ok) throw new Error(await r.text())
      },

      async skipStep(slug: string, step: string, wave: number, reason: string): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/step/${step}/skip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave, reason }),
        })
        if (!r.ok) throw new Error(await r.text())
      },

      async forceMarkComplete(slug: string): Promise<void> {
        const r = await fetch(`/api/wave/${enc(slug)}/mark-complete`, { method: 'POST' })
        if (!r.ok) throw new Error(await r.text())
      },

      async resumeExecution(slug: string): Promise<{ success: boolean; error?: string }> {
        try {
          const r = await fetch(`/api/wave/${enc(slug)}/resume`, { method: 'POST' })
          if (!r.ok) {
            const text = await r.text().catch(() => `HTTP ${r.status}`)
            return { success: false, error: text || `HTTP ${r.status}` }
          }
          return { success: true }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },

      async interruptedSessions(): Promise<InterruptedSession[]> {
        const r = await fetch('/api/sessions/interrupted')
        if (!r.ok) return [] // non-fatal
        return r.json() as Promise<InterruptedSession[]>
      },
    },

    // ── scout namespace ───────────────────────────────────────────────────
    scout: {
      async run(feature: string, repo?: string, context?: ScoutContext): Promise<{ runId: string }> {
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
        await checkShort(r)
        const data = await r.json()
        return { runId: data.run_id }
      },

      subscribeEvents(runId: string): EventSource {
        return new EventSource(`/api/scout/${enc(runId)}/events`)
      },

      async cancel(runId: string): Promise<void> {
        await fetch(`/api/scout/${enc(runId)}/cancel`, { method: 'POST' })
      },

      async rerunScaffold(slug: string): Promise<void> {
        const r = await fetch(`/api/impl/${slug}/scaffold/rerun`, { method: 'POST' })
        if (!r.ok) throw new Error(await r.text())
      },
    },

    // ── config namespace ──────────────────────────────────────────────────
    config: {
      async get(): Promise<SAWConfig> {
        const r = await fetch('/api/config')
        if (!r.ok) throw new Error(await r.text())
        const data = await r.json()
        return { ...data, repos: data.repos ?? [] }
      },

      async save(config: SAWConfig): Promise<void> {
        const r = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        })
        if (!r.ok) throw new Error(await r.text())
      },

      async browse(path?: string): Promise<BrowseResult> {
        const url = path ? `/api/browse?path=${enc(path)}` : '/api/browse'
        const r = await fetch(url)
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<BrowseResult>
      },

      async browseNative(prompt?: string): Promise<string | null> {
        const url = prompt ? `/api/browse/native?prompt=${enc(prompt)}` : '/api/browse/native'
        const r = await fetch(url)
        if (r.status === 204) return null
        if (r.status === 501) throw new Error('unsupported')
        if (!r.ok) throw new Error(await r.text())
        const data = await r.json() as { path: string }
        return data.path
      },

      async validateRepo(path: string): Promise<{ valid: boolean; error?: string; error_code?: string }> {
        const r = await fetch('/api/config/validate-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        return r.json() as Promise<{ valid: boolean; error?: string; error_code?: string }>
      },

      context: {
        async get(): Promise<string> {
          const r = await fetch('/api/context')
          if (r.status === 404) return ''
          if (!r.ok) throw new Error(await r.text())
          return r.text()
        },

        async put(content: string): Promise<void> {
          const r = await fetch('/api/context', {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: content,
          })
          if (!r.ok) throw new Error(await r.text())
        },
      },
    },

    // ── autonomy namespace ────────────────────────────────────────────────
    autonomy: {
      async fetchPipeline(): Promise<PipelineResponse> {
        const r = await fetch('/api/pipeline')
        await check(r)
        return r.json() as Promise<PipelineResponse>
      },

      async fetchQueue(): Promise<QueueItem[]> {
        const r = await fetch('/api/queue')
        await check(r)
        return r.json() as Promise<QueueItem[]>
      },

      async addQueueItem(req: AddQueueItemRequest): Promise<QueueItem> {
        const r = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        })
        await check(r)
        return r.json() as Promise<QueueItem>
      },

      async deleteQueueItem(slug: string): Promise<void> {
        const r = await fetch(`/api/queue/${enc(slug)}`, { method: 'DELETE' })
        await check(r)
      },

      async updateQueuePriority(slug: string, priority: number): Promise<void> {
        const r = await fetch(`/api/queue/${enc(slug)}/priority`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority }),
        })
        await check(r)
      },

      async fetchConfig(): Promise<AutonomyConfig> {
        const r = await fetch('/api/autonomy')
        await check(r)
        return r.json() as Promise<AutonomyConfig>
      },

      async saveConfig(config: AutonomyConfig): Promise<void> {
        const r = await fetch('/api/autonomy', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        })
        await check(r)
      },

      async startDaemon(): Promise<DaemonState> {
        const r = await fetch('/api/daemon/start', { method: 'POST' })
        await check(r)
        return r.json() as Promise<DaemonState>
      },

      async stopDaemon(): Promise<void> {
        const r = await fetch('/api/daemon/stop', { method: 'POST' })
        await check(r)
      },

      async fetchDaemonStatus(): Promise<DaemonState> {
        const r = await fetch('/api/daemon/status')
        await check(r)
        return r.json() as Promise<DaemonState>
      },

      subscribeDaemonEvents(): EventSource {
        return new EventSource('/api/daemon/events')
      },
    },

    // ── program namespace ─────────────────────────────────────────────────
    program: {
      async list(): Promise<ProgramDiscovery[]> {
        const r = await fetch('/api/programs')
        await check(r)
        const data = await r.json()
        return data.programs as ProgramDiscovery[]
      },

      async status(slug: string): Promise<ProgramStatus> {
        const r = await fetch(`/api/program/${enc(slug)}`)
        await check(r)
        return r.json() as Promise<ProgramStatus>
      },

      async tierStatus(slug: string, tier: number): Promise<TierStatus> {
        const r = await fetch(`/api/program/${enc(slug)}/tier/${tier}`)
        await check(r)
        return r.json() as Promise<TierStatus>
      },

      async executeTier(slug: string, tier: number, auto?: boolean): Promise<void> {
        const r = await fetch(`/api/program/${enc(slug)}/tier/${tier}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto: auto ?? false }),
        })
        await check(r)
      },

      async contracts(slug: string): Promise<ContractStatus[]> {
        const r = await fetch(`/api/program/${enc(slug)}/contracts`)
        await check(r)
        return r.json() as Promise<ContractStatus[]>
      },

      async replan(slug: string): Promise<void> {
        const r = await fetch(`/api/program/${enc(slug)}/replan`, { method: 'POST' })
        await check(r)
      },

      async runPlanner(description: string, repo?: string): Promise<{ runId: string }> {
        const r = await fetch('/api/planner/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, repo }),
        })
        await check(r)
        const data = await r.json() as { run_id: string }
        return { runId: data.run_id }
      },

      subscribePlannerEvents(runId: string): EventSource {
        return new EventSource(`/api/planner/${enc(runId)}/events`)
      },

      async cancelPlanner(runId: string): Promise<void> {
        await fetch(`/api/planner/${enc(runId)}/cancel`, { method: 'POST' })
      },

      async analyzeImpls(slugs: string[], repo?: string): Promise<ConflictReport> {
        const r = await fetch('/api/programs/analyze-impls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs, repo_path: repo }),
        })
        await check(r)
        return r.json() as Promise<ConflictReport>
      },

      async createFromImpls(slugs: string[], name?: string, programSlug?: string, repo?: string): Promise<GenerateProgramResult> {
        const r = await fetch('/api/programs/create-from-impls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs, name, program_slug: programSlug, repo_path: repo }),
        })
        await check(r)
        return r.json() as Promise<GenerateProgramResult>
      },
    },

    // ── notifications namespace ──────────────────────────────────────────
    notifications: {
      async getPreferences(): Promise<any> {
        const r = await fetch('/api/notifications/preferences')
        if (!r.ok) throw new Error(`Failed to fetch notification preferences: ${r.statusText}`)
        return r.json()
      },

      async savePreferences(prefs: any): Promise<void> {
        const r = await fetch('/api/notifications/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs),
        })
        if (!r.ok) throw new Error(`Failed to save notification preferences: ${r.statusText}`)
      },
    },

    // ── bootstrap namespace ──────────────────────────────────────────────
    bootstrap: {
      async run(description: string, repo?: string): Promise<{ run_id: string }> {
        const r = await fetch('/api/bootstrap/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, repo }),
        })
        if (!r.ok) {
          const text = await r.text()
          throw new Error(`Bootstrap failed: ${text}`)
        }
        return r.json() as Promise<{ run_id: string }>
      },
    },

    // ── files namespace ───────────────────────────────────────────────────
    files: {
      async tree(repo: string, path?: string): Promise<FileTreeResponse> {
        const params = new URLSearchParams({ repo })
        if (path !== undefined) params.set('path', path)
        const r = await fetch(`/api/files/tree?${params}`)
        await check(r)
        return r.json() as Promise<FileTreeResponse>
      },

      async read(repo: string, path: string): Promise<FileContentResponse> {
        const params = new URLSearchParams({ repo, path })
        const r = await fetch(`/api/files/read?${params}`)
        await check(r)
        return r.json() as Promise<FileContentResponse>
      },

      async diff(repo: string, path: string): Promise<{ repo: string; path: string; diff: string }> {
        const params = new URLSearchParams({ repo, path })
        const r = await fetch(`/api/files/diff?${params}`)
        await check(r)
        return r.json() as Promise<{ repo: string; path: string; diff: string }>
      },

      async gitStatus(repo: string): Promise<GitStatusResponse> {
        const params = new URLSearchParams({ repo })
        const r = await fetch(`/api/files/status?${params}`)
        await check(r)
        return r.json() as Promise<GitStatusResponse>
      },

      async resolve(path: string): Promise<FileResolveResponse> {
        const params = new URLSearchParams({ path })
        const r = await fetch(`/api/files/resolve?${params}`)
        await check(r)
        return r.json() as Promise<FileResolveResponse>
      },
    },
  }
}

// ─── Default singleton instance ─────────────────────────────────────────────

export const sawClient = createHttpClient()
