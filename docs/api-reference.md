# saw API Reference

The `saw serve` command exposes an HTTP API on `localhost:7432` (configurable via `--addr`). All endpoints return JSON unless otherwise noted. SSE (Server-Sent Events) endpoints stream `text/event-stream`.

**Base URL:** `http://localhost:7432`

## Quick Reference

| Endpoint | Method | Category | Description |
|----------|--------|----------|-------------|
| `/api/events` | GET (SSE) | Global | Global event stream (impl list updates) |
| `/api/browse` | GET | Navigation | Open native file browser |
| `/api/browse/native` | GET | Navigation | Launch OS file picker |
| `/api/impl` | GET | IMPL Docs | List all IMPL docs |
| `/api/impl/{slug}` | GET | IMPL Docs | Get IMPL doc details |
| `/api/impl/{slug}` | DELETE | IMPL Docs | Delete IMPL doc |
| `/api/impl/{slug}/archive` | POST | IMPL Docs | Archive IMPL doc |
| `/api/impl/{slug}/raw` | GET | IMPL Docs | Get raw IMPL doc content |
| `/api/impl/{slug}/raw` | PUT | IMPL Docs | Update raw IMPL doc |
| `/api/impl/{slug}/approve` | POST | Review | Mark IMPL as approved |
| `/api/impl/{slug}/reject` | POST | Review | Mark IMPL as rejected |
| `/api/impl/{slug}/diff/{agent}` | GET | Review | Get file diffs for agent |
| `/api/impl/{slug}/amend` | POST | Review | Amend IMPL doc via AI |
| `/api/impl/{slug}/critic-review` | GET | Critic | Get critic review for IMPL |
| `/api/impl/{slug}/run-critic` | POST | Critic | Run critic review agent |
| `/api/impl/{slug}/fix-critic` | PATCH | Critic | Apply critic fix to IMPL |
| `/api/impl/{slug}/auto-fix-critic` | POST | Critic | Auto-fix all critic issues |
| `/api/impl/{slug}/validate-integration` | GET | Validation | Check integration gaps |
| `/api/impl/{slug}/validate-wiring` | GET | Validation | Check wiring gaps |
| `/api/impl/import` | POST | IMPL Docs | Bulk import IMPLs into a program |
| `/api/scout/run` | POST | Scout | Run Scout agent |
| `/api/scout/{slug}/rerun` | POST | Scout | Re-run Scout for existing IMPL |
| `/api/scout/{runID}/events` | GET (SSE) | Scout | Scout execution event stream |
| `/api/scout/{runID}/cancel` | POST | Scout | Cancel running Scout |
| `/api/wave/{slug}/start` | POST | Wave | Start wave execution |
| `/api/wave/{slug}/events` | GET (SSE) | Wave | Wave execution event stream |
| `/api/wave/{slug}/state` | GET | Wave | Get current wave state machine |
| `/api/wave/{slug}/status` | GET | Wave | Get agent progress status |
| `/api/wave/{slug}/disk-status` | GET | Wave | Get worktree disk status |
| `/api/wave/{slug}/review/{wave}` | GET | Wave | Get wave review data |
| `/api/wave/{slug}/merge` | POST | Wave | Merge completed wave |
| `/api/wave/{slug}/finalize` | POST | Wave | Finalize wave (full pipeline) |
| `/api/wave/{slug}/merge-abort` | POST | Wave | Abort an in-progress merge |
| `/api/wave/{slug}/test` | POST | Wave | Run post-merge tests |
| `/api/wave/{slug}/gate/proceed` | POST | Wave | Proceed past quality gate |
| `/api/wave/{slug}/agent/{letter}/rerun` | POST | Wave | Re-run specific agent |
| `/api/wave/{slug}/resume` | POST | Wave | Resume interrupted execution |
| `/api/wave/{slug}/resolve-conflicts` | POST | Wave | Resolve merge conflicts |
| `/api/wave/{slug}/fix-build` | POST | Wave | Fix build failures |
| `/api/wave/{slug}/step/{step}/retry` | POST | Recovery | Retry a failed pipeline step |
| `/api/wave/{slug}/step/{step}/skip` | POST | Recovery | Skip a pipeline step |
| `/api/wave/{slug}/mark-complete` | POST | Recovery | Force-mark wave complete |
| `/api/wave/{slug}/pipeline` | GET | Recovery | Get pipeline state |
| `/api/sessions/interrupted` | GET | Sessions | List interrupted sessions |
| `/api/impl/{slug}/worktrees` | GET | Worktrees | List worktrees for IMPL |
| `/api/impl/{slug}/worktrees/{branch}` | DELETE | Worktrees | Delete specific worktree |
| `/api/impl/{slug}/worktrees/cleanup` | POST | Worktrees | Batch delete worktrees |
| `/api/worktrees/cleanup-stale` | POST | Worktrees | Global stale worktree cleanup |
| `/api/impl/{slug}/chat` | POST | Chat | Start chat session |
| `/api/impl/{slug}/chat/{runID}/events` | GET (SSE) | Chat | Chat message stream |
| `/api/impl/{slug}/revise` | POST | Revise | Revise IMPL doc via AI |
| `/api/impl/{slug}/revise/{runID}/events` | GET (SSE) | Revise | Revise event stream |
| `/api/impl/{slug}/revise/{runID}/cancel` | POST | Revise | Cancel revision |
| `/api/impl/{slug}/scaffold/rerun` | POST | Scaffold | Re-run scaffold agent |
| `/api/impl/{slug}/agent/{letter}/context` | GET | Context | Get agent context payload |
| `/api/context` | GET | Context | Get CONTEXT.md content |
| `/api/context` | PUT | Context | Update CONTEXT.md |
| `/api/config` | GET | Config | Get saw.config.json |
| `/api/config` | POST | Config | Update saw.config.json |
| `/api/config/validate-repo` | POST | Config | Validate a repository path |
| `/api/bootstrap/run` | POST | Bootstrap | Run bootstrap for new project |
| `/api/notifications/preferences` | GET | Notifications | Get notification preferences |
| `/api/notifications/preferences` | POST | Notifications | Save notification preferences |
| `/api/manifest/{slug}` | GET | Manifest | Load YAML manifest |
| `/api/manifest/{slug}/validate` | POST | Manifest | Validate manifest |
| `/api/manifest/{slug}/wave/{number}` | GET | Manifest | Get specific wave |
| `/api/manifest/{slug}/completion/{agentID}` | POST | Manifest | Set completion report |
| `/api/journal/{wave}/{agent}` | GET | Journal | Get tool usage journal |
| `/api/journal/{wave}/{agent}/summary` | GET | Journal | Get journal summary |
| `/api/journal/{wave}/{agent}/checkpoints` | GET | Journal | List journal checkpoints |
| `/api/journal/{wave}/{agent}/restore` | POST | Journal | Restore from checkpoint |
| `/api/planner/run` | POST | Planner | Run Planner agent |
| `/api/planner/{runID}/events` | GET (SSE) | Planner | Planner execution event stream |
| `/api/planner/{runID}/cancel` | POST | Planner | Cancel running Planner |
| `/api/programs` | GET | Programs | List all PROGRAM manifests |
| `/api/programs/analyze-impls` | POST | Programs | Analyze IMPLs for program creation |
| `/api/programs/create-from-impls` | POST | Programs | Create program from IMPLs |
| `/api/program/{slug}` | GET | Programs | Get program status |
| `/api/program/{slug}/tier/{n}` | GET | Programs | Get tier status |
| `/api/program/{slug}/tier/{n}/execute` | POST | Programs | Execute a tier |
| `/api/program/{slug}/contracts` | GET | Programs | Get program contracts |
| `/api/program/{slug}/replan` | POST | Programs | Re-plan a program |
| `/api/program/events` | GET (SSE) | Programs | Program event stream |
| `/api/pipeline` | GET | Autonomy | Get pipeline state |
| `/api/queue` | GET | Autonomy | List execution queue |
| `/api/queue` | POST | Autonomy | Add item to queue |
| `/api/queue/{slug}` | DELETE | Autonomy | Remove item from queue |
| `/api/queue/{slug}/priority` | PUT | Autonomy | Reorder queue item priority |
| `/api/autonomy` | GET | Autonomy | Get autonomy settings |
| `/api/autonomy` | PUT | Autonomy | Update autonomy settings |
| `/api/daemon/start` | POST | Daemon | Start background daemon |
| `/api/daemon/stop` | POST | Daemon | Stop background daemon |
| `/api/daemon/status` | GET | Daemon | Get daemon status |
| `/api/daemon/events` | GET (SSE) | Daemon | Daemon event stream |
| `/api/interview/start` | POST | Interview | Start interview session |
| `/api/interview/{runID}/events` | GET (SSE) | Interview | Interview event stream |
| `/api/interview/{runID}/answer` | POST | Interview | Submit interview answer |
| `/api/interview/{runID}/cancel` | POST | Interview | Cancel interview |
| `/api/observability/metrics/{impl_slug}` | GET | Observability | Get IMPL metrics |
| `/api/observability/metrics/program/{program_slug}` | GET | Observability | Get program metrics summary |
| `/api/observability/events` | GET | Observability | Query observability events |
| `/api/observability/rollup` | GET | Observability | Get aggregated rollup |
| `/api/observability/cost-breakdown/{impl_slug}` | GET | Observability | Get cost breakdown |
| `/api/files/tree` | GET | Files | Browse file tree |
| `/api/files/read` | GET | Files | Read file contents |
| `/api/files/diff` | GET | Files | Get file diff |
| `/api/files/status` | GET | Files | Get file git status |

---

## Global Events

### GET /api/events

Global SSE stream for server-wide events (e.g., IMPL list updates).

**Response:** `text/event-stream`

**Events:**
- `impl_list_updated` -- IMPL directory changed (new/modified/deleted files)
  ```json
  {"event": "impl_list_updated"}
  ```

**Example:**
```javascript
const es = new EventSource('/api/events');
es.addEventListener('impl_list_updated', () => {
  // Refresh IMPL list
});
```

---

## Navigation

### GET /api/browse

Open native OS file browser at repository root.

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `500` if file browser fails to launch

---

### GET /api/browse/native

Launch native OS file picker dialog (currently same as `/api/browse`).

**Response:**
```json
{"status": "ok"}
```

---

## IMPL Document Operations

### GET /api/impl

List all IMPL docs in the configured `--impl-dir`.

**Response:**
```json
{
  "impls": [
    {
      "slug": "oauth",
      "title": "Add OAuth 2.0 authentication",
      "path": "/abs/path/to/docs/IMPL/IMPL-oauth.yaml",
      "status": "suitable",
      "format": "yaml",
      "wave_count": 3,
      "agent_count": 8,
      "current_wave": 2
    }
  ]
}
```

**Fields:**
- `slug` -- Filename without `IMPL-` prefix and extension
- `status` -- `pending`, `suitable`, `not-suitable`, `in-progress`, `complete`
- `format` -- `markdown` or `yaml`

---

### GET /api/impl/{slug}

Get parsed IMPL doc with full wave/agent details.

**Path params:**
- `slug` -- IMPL doc slug (e.g., `oauth` for `IMPL-oauth.yaml`)

**Response:**
```json
{
  "slug": "oauth",
  "title": "Add OAuth 2.0 authentication",
  "path": "/abs/path/to/IMPL-oauth.yaml",
  "format": "yaml",
  "raw": "...",
  "verdict": {
    "status": "suitable",
    "reason": "Clear scope, well-defined waves",
    "complexity": "medium"
  },
  "waves": [
    {
      "wave": 1,
      "agents": [
        {
          "id": "A",
          "task": "Implement OAuth client",
          "files": ["pkg/oauth/client.go"],
          "dependencies": [],
          "status": "complete"
        }
      ]
    }
  ],
  "interface_contracts": [
    {
      "file": "pkg/oauth/types.go",
      "description": "OAuth token types",
      "frozen": true
    }
  ],
  "file_ownership": {
    "pkg/oauth/client.go": "A",
    "pkg/oauth/storage.go": "B"
  }
}
```

**Status:** `200 OK` on success, `404` if not found, `500` on parse error

---

### DELETE /api/impl/{slug}

Delete an IMPL doc file.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `404` if not found

---

### POST /api/impl/{slug}/archive

Archive an IMPL doc (move to `complete/` subdirectory).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `404` if not found

---

### GET /api/impl/{slug}/raw

Get raw IMPL doc content (markdown or YAML).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "content": "# IMPL: Add OAuth...",
  "format": "markdown"
}
```

**Status:** `200 OK` on success, `404` if not found

---

### PUT /api/impl/{slug}/raw

Update raw IMPL doc content.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "content": "# IMPL: Updated content..."
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `400` on invalid JSON, `500` on write error

---

### POST /api/impl/import

Bulk import IMPL docs into a program.

**Request body:**
```json
{
  "program_slug": "my-program",
  "impl_slugs": ["oauth", "caching", "rate-limit"]
}
```

**Response:**
```json
{"status": "ok", "imported": 3}
```

**Status:** `200 OK` on success, `400` on invalid request

---

## Review Operations

### POST /api/impl/{slug}/approve

Mark IMPL doc as approved (sets status to `approved` in metadata).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` always

---

### POST /api/impl/{slug}/reject

Mark IMPL doc as rejected (sets status to `rejected` in metadata).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` always

---

### GET /api/impl/{slug}/diff/{agent}

Get file diffs for a specific agent's worktree.

**Path params:**
- `slug` -- IMPL doc slug
- `agent` -- Agent letter (e.g., `A`, `B`)

**Query params:**
- `wave` -- Wave number (optional)
- `file` -- URL-encoded file path to get diff for specific file (optional)

**Response:**
```json
{
  "agent": "A",
  "diffs": [
    {
      "file": "pkg/oauth/client.go",
      "diff": "@@ -1,5 +1,8 @@\n package oauth\n+\n+import \"net/http\"\n..."
    }
  ]
}
```

**Status:** `200 OK` on success, `404` if agent/worktree not found

---

### POST /api/impl/{slug}/amend

Amend an IMPL doc using AI based on feedback.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "feedback": "Add error handling to Wave 2 agents"
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

## Critic Operations

### GET /api/impl/{slug}/critic-review

Get the most recent critic review for an IMPL doc.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "review": {
    "issues": [...],
    "score": 85,
    "timestamp": "2026-03-15T10:30:00Z"
  }
}
```

**Status:** `200 OK` on success, `404` if no review found

---

### POST /api/impl/{slug}/run-critic

Run critic review agent against an IMPL doc.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok", "run_id": "..."}
```

**Status:** `200 OK` on success

---

### PATCH /api/impl/{slug}/fix-critic

Apply a specific critic fix to an IMPL doc.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "issue_id": "critic-1",
  "fix": "..."
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### POST /api/impl/{slug}/auto-fix-critic

Automatically fix all critic issues in an IMPL doc.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok", "fixed": 3}
```

**Status:** `200 OK` on success

---

## Validation Operations

### GET /api/impl/{slug}/validate-integration

Check for integration gaps in an IMPL doc (missing cross-agent dependencies, untested interfaces).

**Path params:**
- `slug` -- IMPL doc slug

**Query params:**
- `wave` -- Wave number to check (optional)

**Response:**
```json
{
  "gaps": [...],
  "valid": true
}
```

**Status:** `200 OK` on success

---

### GET /api/impl/{slug}/validate-wiring

Check for wiring gaps in an IMPL doc (unconnected components, missing imports).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "gaps": [...],
  "valid": true
}
```

**Status:** `200 OK` on success

---

## Scout Operations

### POST /api/scout/run

Run Scout agent to generate a new IMPL doc.

**Request body:**
```json
{
  "feature": "Add OAuth 2.0 authentication",
  "backend": "auto"
}
```

**Fields:**
- `feature` -- Feature description (required)
- `backend` -- `api`, `cli`, or `auto` (optional; default: `auto`)

**Response:**
```json
{
  "run_id": "1773031123005120000",
  "slug": "oauth"
}
```

**Status:** `200 OK` on success, `400` on invalid request

**See also:** `GET /api/scout/{runID}/events` for execution stream

---

### POST /api/scout/{slug}/rerun

Re-run Scout agent for an existing IMPL doc (regenerate based on current codebase).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "run_id": "1773031456789012000"
}
```

**Status:** `200 OK` on success, `404` if IMPL not found

---

### GET /api/scout/{runID}/events

SSE stream for Scout agent execution.

**Path params:**
- `runID` -- Run ID from `POST /api/scout/run` response

**Response:** `text/event-stream`

**Events:**
- `scout_output` -- Streaming output chunk
  ```json
  {"run_id": "...", "chunk": "Analyzing codebase..."}
  ```
- `scout_complete` -- Scout finished successfully
  ```json
  {"run_id": "...", "slug": "oauth", "path": "/path/to/IMPL-oauth.yaml"}
  ```
- `scout_failed` -- Scout failed
  ```json
  {"run_id": "...", "error": "Failed to parse..."}
  ```

---

### POST /api/scout/{runID}/cancel

Cancel a running Scout agent.

**Path params:**
- `runID` -- Run ID from Scout run

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` if cancelled, `404` if run not found

---

## Wave Execution

### POST /api/wave/{slug}/start

Start wave execution for an IMPL doc.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "wave_num": 1,
  "auto": true
}
```

**Fields:**
- `wave_num` -- Wave number to execute (default: `1`)
- `auto` -- Continue automatically after completion (default: `false`)

**Response:**
```json
{"status": "started"}
```

**Status:** `200 OK` on success, `409` if wave already running

**See also:** `GET /api/wave/{slug}/events` for execution stream

---

### GET /api/wave/{slug}/events

SSE stream for wave execution events.

**Path params:**
- `slug` -- IMPL doc slug

**Response:** `text/event-stream`

**Events:**
- `wave_started` -- Wave execution began
  ```json
  {"wave": 1, "agents": ["A", "B"]}
  ```
- `agent_status` -- Agent status changed
  ```json
  {"wave": 1, "agent": "A", "status": "running"}
  ```
- `agent_output` -- Agent stdout/stderr line
  ```json
  {"wave": 1, "agent": "A", "line": "Processing file..."}
  ```
- `agent_complete` -- Agent finished
  ```json
  {"wave": 1, "agent": "A", "status": "complete"}
  ```
- `agent_failed` -- Agent failed
  ```json
  {"wave": 1, "agent": "A", "error": "Build failed"}
  ```
- `wave_complete` -- All agents in wave finished
  ```json
  {"wave": 1, "status": "complete"}
  ```
- `merge_started` -- Merge operation began
  ```json
  {"wave": 1}
  ```
- `merge_complete` -- Merge succeeded
  ```json
  {"wave": 1, "status": "merged"}
  ```
- `merge_failed` -- Merge failed
  ```json
  {"wave": 1, "error": "Conflict in file..."}
  ```
- `run_complete` -- All waves finished
  ```json
  {"status": "success", "waves": 3, "agents": 8}
  ```
- `run_failed` -- Wave run failed
  ```json
  {"error": "Wave 2 failed: Agent C blocked"}
  ```

---

### GET /api/wave/{slug}/state

Get current wave state machine status.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "stage": "wave_executing",
  "wave": 2,
  "agents": {
    "A": "complete",
    "B": "running",
    "C": "pending"
  }
}
```

**Stages:** `scout_pending`, `reviewed`, `scaffold_pending`, `wave_pending`, `wave_executing`, `wave_merging`, `wave_verified`, `complete`, `blocked`, `not_suitable`

**Status:** `200 OK` on success, `404` if IMPL not found

---

### GET /api/wave/{slug}/status

Get agent progress status for a wave (real-time agent progress tracking).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "agents": {
    "A": {"status": "running", "progress": 75},
    "B": {"status": "complete"}
  }
}
```

**Status:** `200 OK` on success

---

### GET /api/wave/{slug}/disk-status

Get worktree disk status for a wave (disk usage, file counts).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "worktrees": [
    {"agent": "A", "path": "/path/to/worktree", "size_bytes": 1234567}
  ]
}
```

**Status:** `200 OK` on success

---

### GET /api/wave/{slug}/review/{wave}

Get review data for a specific wave (diffs, commit summaries, gate results).

**Path params:**
- `slug` -- IMPL doc slug
- `wave` -- Wave number

**Response:**
```json
{
  "wave": 1,
  "agents": [...],
  "diffs": [...],
  "gate_results": [...]
}
```

**Status:** `200 OK` on success, `404` if wave not found

---

### POST /api/wave/{slug}/merge

Manually trigger merge for a completed wave.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "wave_num": 1
}
```

**Response:**
```json
{"status": "merging"}
```

**Status:** `200 OK` on success, `409` if merge already in progress

---

### POST /api/wave/{slug}/finalize

Finalize a wave (run the full post-wave pipeline: verify commits, scan stubs, run gates, merge, verify build, cleanup).

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "wave_num": 1
}
```

**Response:**
```json
{"status": "finalizing"}
```

**Status:** `200 OK` on success, `409` if already in progress

---

### POST /api/wave/{slug}/merge-abort

Abort an in-progress merge operation.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### POST /api/wave/{slug}/test

Run post-merge test suite for a wave.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "wave_num": 1
}
```

**Response:**
```json
{
  "status": "running",
  "test_id": "..."
}
```

**Status:** `200 OK` on success

---

### POST /api/wave/{slug}/gate/proceed

Proceed past a quality gate checkpoint (when paused for review).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### POST /api/wave/{slug}/agent/{letter}/rerun

Re-run a specific agent in a wave (recovery tool).

**Path params:**
- `slug` -- IMPL doc slug
- `letter` -- Agent letter (e.g., `A`, `B`)

**Response:**
```json
{"status": "rerunning"}
```

**Status:** `200 OK` on success, `404` if agent not found

---

### POST /api/wave/{slug}/resume

Resume an interrupted wave execution.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "resumed"}
```

**Status:** `200 OK` on success, `404` if no interrupted session found

---

### POST /api/wave/{slug}/resolve-conflicts

Resolve merge conflicts for a wave (launches conflict resolution agent).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "resolving"}
```

**Status:** `200 OK` on success

---

### POST /api/wave/{slug}/fix-build

Fix build failures after merge (launches build fix agent).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "fixing"}
```

**Status:** `200 OK` on success

---

## Recovery Operations

### POST /api/wave/{slug}/step/{step}/retry

Retry a specific failed pipeline step.

**Path params:**
- `slug` -- IMPL doc slug
- `step` -- Pipeline step name (e.g., `verify_commits`, `scan_stubs`, `run_gates`, `validate_integration`, `merge_agents`, `fix_go_mod`, `verify_build`, `integration_agent`, `cleanup`)

**Request body:**
```json
{
  "wave": 1
}
```

**Response:**
```json
{"status": "retrying"}
```

**Status:** `200 OK` on success, `400` if step is invalid

---

### POST /api/wave/{slug}/step/{step}/skip

Skip a pipeline step (only allowed for skippable steps).

**Path params:**
- `slug` -- IMPL doc slug
- `step` -- Pipeline step name

**Request body:**
```json
{
  "wave": 1,
  "reason": "Known flaky test, skip for now"
}
```

**Response:**
```json
{"status": "skipped"}
```

**Status:** `200 OK` on success, `400` if step is not skippable

---

### POST /api/wave/{slug}/mark-complete

Force-mark a wave as complete (emergency recovery).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### GET /api/wave/{slug}/pipeline

Get current pipeline state for a wave (step statuses, current step, errors).

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "steps": [
    {"name": "verify_commits", "status": "complete"},
    {"name": "run_gates", "status": "failed", "error": "test failure"}
  ],
  "current_step": "run_gates"
}
```

**Status:** `200 OK` on success

---

## Session Management

### GET /api/sessions/interrupted

List interrupted wave sessions that can be resumed.

**Response:**
```json
{
  "sessions": [
    {
      "slug": "oauth",
      "wave": 2,
      "interrupted_at": "2026-03-15T10:30:00Z",
      "agents": {"A": "complete", "B": "running"}
    }
  ]
}
```

**Status:** `200 OK` always

---

## Worktree Management

### GET /api/impl/{slug}/worktrees

List all worktrees associated with an IMPL doc.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "worktrees": [
    {
      "branch": "wave-1-agent-A",
      "path": "/path/to/.claude/worktrees/wave-1-agent-A",
      "agent": "A",
      "wave": 1,
      "status": "active"
    }
  ]
}
```

**Status:** `200 OK` on success

---

### DELETE /api/impl/{slug}/worktrees/{branch}

Delete a specific worktree.

**Path params:**
- `slug` -- IMPL doc slug
- `branch` -- Branch name (e.g., `wave-1-agent-A`)

**Query params:**
- `force` -- Set to `true` to force deletion (optional)

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `404` if not found

---

### POST /api/impl/{slug}/worktrees/cleanup

Batch delete worktrees for completed waves.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "wave_num": 1
}
```

**Response:**
```json
{
  "deleted": ["wave-1-agent-A", "wave-1-agent-B"],
  "count": 2
}
```

**Status:** `200 OK` on success

---

### POST /api/worktrees/cleanup-stale

Trigger global stale worktree cleanup across all repos.

**Response:**
```json
{"status": "ok", "cleaned": 5}
```

**Status:** `200 OK` on success

---

## Chat Operations

### POST /api/impl/{slug}/chat

Start a chat session with Claude about an IMPL doc.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "message": "What does Agent B do?",
  "history": [
    {"role": "user", "content": "Explain this IMPL"},
    {"role": "assistant", "content": "This IMPL adds OAuth..."}
  ]
}
```

**Fields:**
- `message` -- User message (required)
- `history` -- Previous conversation turns (optional)

**Response:**
```json
{
  "run_id": "1773031678901230000"
}
```

**Status:** `200 OK` on success

**See also:** `GET /api/impl/{slug}/chat/{runID}/events` for response stream

---

### GET /api/impl/{slug}/chat/{runID}/events

SSE stream for chat response.

**Path params:**
- `slug` -- IMPL doc slug
- `runID` -- Run ID from chat request

**Response:** `text/event-stream`

**Events:**
- `chat_output` -- Response chunk
  ```json
  {"run_id": "...", "chunk": "Agent B implements..."}
  ```
- `chat_complete` -- Response finished
  ```json
  {"run_id": "...", "slug": "oauth"}
  ```
- `chat_failed` -- Chat failed
  ```json
  {"run_id": "...", "error": "API error"}
  ```

---

## Revise Operations

### POST /api/impl/{slug}/revise

Request AI revision of an IMPL doc based on feedback.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "feedback": "Split Wave 2 into two waves for better parallelization"
}
```

**Response:**
```json
{
  "run_id": "1773031890123450000"
}
```

**Status:** `200 OK` on success

---

### GET /api/impl/{slug}/revise/{runID}/events

SSE stream for revision process.

**Path params:**
- `slug` -- IMPL doc slug
- `runID` -- Run ID from revise request

**Response:** `text/event-stream`

**Events:**
- `revise_output` -- Progress update
  ```json
  {"run_id": "...", "chunk": "Analyzing wave dependencies..."}
  ```
- `revise_complete` -- Revision finished
  ```json
  {"run_id": "...", "slug": "oauth"}
  ```
- `revise_failed` -- Revision failed
  ```json
  {"run_id": "...", "error": "..."}
  ```

---

### POST /api/impl/{slug}/revise/{runID}/cancel

Cancel an in-progress revision.

**Path params:**
- `slug` -- IMPL doc slug
- `runID` -- Run ID from revise request

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` if cancelled, `404` if not found

---

## Scaffold Operations

### POST /api/impl/{slug}/scaffold/rerun

Re-run scaffold agent to regenerate interface contract stubs.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "run_id": "1773032012345670000",
  "status": "running"
}
```

**Status:** `200 OK` on success

---

## Context Operations

### GET /api/impl/{slug}/agent/{letter}/context

Get agent-specific context payload (E23).

**Path params:**
- `slug` -- IMPL doc slug
- `letter` -- Agent letter (e.g., `A`, `B`)

**Response:**
```json
{
  "task": "Implement OAuth client with PKCE",
  "files": ["pkg/oauth/client.go"],
  "dependencies": [],
  "impl_doc_path": "/path/to/IMPL-oauth.yaml"
}
```

**Status:** `200 OK` on success, `404` if agent not found

---

### GET /api/context

Get CONTEXT.md content (project-wide context file).

**Response:**
```json
{
  "content": "# Project Context\n\n...",
  "exists": true
}
```

**Status:** `200 OK` always (returns empty if file doesn't exist)

---

### PUT /api/context

Update CONTEXT.md content.

**Request body:**
```json
{
  "content": "# Updated Context\n\n..."
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `500` on write error

---

## Configuration

### GET /api/config

Get current `saw.config.json` configuration.

**Response:**
```json
{
  "repos": [
    {
      "path": "/path/to/project",
      "name": "MyProject",
      "active": true
    }
  ],
  "agent": {
    "scout_model": "claude-sonnet-4",
    "wave_model": "claude-sonnet-4",
    "chat_model": "claude-sonnet-4"
  },
  "quality": {
    "require_tests": true,
    "require_lint": false,
    "block_on_failure": true
  },
  "appearance": {
    "theme": "system"
  }
}
```

**Status:** `200 OK` always (returns defaults if config doesn't exist)

---

### POST /api/config

Update `saw.config.json` configuration.

**Request body:** Same structure as GET response

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `400` on invalid JSON, `500` on write error

---

### POST /api/config/validate-repo

Validate a repository path (check if it's a valid git repo with appropriate structure).

**Request body:**
```json
{
  "path": "/path/to/repo"
}
```

**Response:**
```json
{
  "valid": true,
  "name": "my-project"
}
```

**Status:** `200 OK` always (validation result in body)

---

## Bootstrap

### POST /api/bootstrap/run

Run bootstrap workflow for a new project (creates CONTEXT.md, initializes IMPL directory, etc.).

**Request body:**
```json
{
  "repo_path": "/path/to/project"
}
```

**Response:**
```json
{"status": "ok", "run_id": "..."}
```

**Status:** `200 OK` on success

---

## Notifications

### GET /api/notifications/preferences

Get notification preferences.

**Response:**
```json
{
  "preferences": {
    "wave_complete": true,
    "agent_failed": true,
    "merge_conflict": true
  }
}
```

**Status:** `200 OK` always

---

### POST /api/notifications/preferences

Save notification preferences.

**Request body:** Same structure as GET response

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

## Manifest Operations

### GET /api/manifest/{slug}

Load and parse a YAML IMPL manifest.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "feature": "Add OAuth 2.0 authentication",
  "verdict": {
    "status": "suitable",
    "reason": "...",
    "complexity": "medium"
  },
  "waves": [...],
  "interface_contracts": [...]
}
```

**Status:** `200 OK` on success, `404` if not found, `500` on parse error

---

### POST /api/manifest/{slug}/validate

Validate a YAML manifest against protocol invariants.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{
  "valid": true,
  "errors": []
}
```

**Or with errors:**
```json
{
  "valid": false,
  "errors": [
    {
      "code": "E16C",
      "message": "Duplicate agent ID 'A' in wave 2",
      "line": 45
    }
  ]
}
```

**Status:** `200 OK` always (validation result in body)

---

### GET /api/manifest/{slug}/wave/{number}

Get a specific wave from a manifest.

**Path params:**
- `slug` -- IMPL doc slug
- `number` -- Wave number

**Response:**
```json
{
  "wave": 2,
  "agents": [
    {
      "id": "C",
      "task": "...",
      "files": [...],
      "dependencies": ["A"]
    }
  ]
}
```

**Status:** `200 OK` on success, `404` if wave not found

---

### POST /api/manifest/{slug}/completion/{agentID}

Set completion report for an agent.

**Path params:**
- `slug` -- IMPL doc slug
- `agentID` -- Agent ID (e.g., `A`, `B`)

**Request body:**
```json
{
  "status": "complete",
  "summary": "Implemented OAuth client",
  "files_modified": ["pkg/oauth/client.go"],
  "tests_added": 12,
  "notes": "Added integration tests"
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `400` on invalid JSON, `500` on save error

---

## Journal Operations

### GET /api/journal/{wave}/{agent}

Get full tool usage journal for an agent.

**Path params:**
- `wave` -- Wave number
- `agent` -- Agent letter

**Response:**
```json
{
  "wave": 1,
  "agent": "A",
  "entries": [
    {
      "timestamp": "2026-03-11T10:30:00Z",
      "tool": "Read",
      "args": {"file_path": "/path/to/file.go"},
      "result": "success"
    }
  ]
}
```

**Status:** `200 OK` on success, `404` if journal not found

---

### GET /api/journal/{wave}/{agent}/summary

Get summary statistics for agent's tool usage.

**Path params:**
- `wave` -- Wave number
- `agent` -- Agent letter

**Response:**
```json
{
  "total_tools": 45,
  "by_type": {
    "Read": 12,
    "Write": 8,
    "Bash": 15,
    "Edit": 10
  },
  "duration_seconds": 320
}
```

**Status:** `200 OK` on success, `404` if journal not found

---

### GET /api/journal/{wave}/{agent}/checkpoints

List available checkpoints in agent's journal.

**Path params:**
- `wave` -- Wave number
- `agent` -- Agent letter

**Response:**
```json
{
  "checkpoints": [
    {
      "id": "1",
      "timestamp": "2026-03-11T10:35:00Z",
      "description": "After parsing config"
    }
  ]
}
```

**Status:** `200 OK` on success, `404` if journal not found

---

### POST /api/journal/{wave}/{agent}/restore

Restore agent state from a checkpoint.

**Path params:**
- `wave` -- Wave number
- `agent` -- Agent letter

**Request body:**
```json
{
  "checkpoint_id": "1"
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `404` if checkpoint not found

---

## Planner Operations

### POST /api/planner/run

Run Planner agent to produce a PROGRAM manifest from a feature description.

**Request body:**
```json
{
  "feature": "E-commerce platform with payments and inventory",
  "backend": "auto"
}
```

**Response:**
```json
{
  "run_id": "1773031123005120000"
}
```

**Status:** `200 OK` on success, `400` on invalid request

---

### GET /api/planner/{runID}/events

SSE stream for Planner agent execution.

**Path params:**
- `runID` -- Run ID from `POST /api/planner/run` response

**Response:** `text/event-stream`

**Events:**
- `planner_output` -- Streaming output chunk
- `planner_complete` -- Planner finished successfully
- `planner_failed` -- Planner failed

---

### POST /api/planner/{runID}/cancel

Cancel a running Planner agent.

**Path params:**
- `runID` -- Run ID from Planner run

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` if cancelled, `404` if run not found

---

## Program Operations

### GET /api/programs

List all PROGRAM manifests.

**Response:**
```json
{
  "programs": [
    {
      "slug": "ecommerce",
      "title": "E-commerce Platform",
      "tier_count": 3,
      "status": "in_progress"
    }
  ]
}
```

**Status:** `200 OK` always

---

### POST /api/programs/analyze-impls

Analyze existing IMPLs to suggest program groupings and dependencies.

**Request body:**
```json
{
  "impl_slugs": ["oauth", "caching", "rate-limit"]
}
```

**Response:**
```json
{
  "suggestions": [...]
}
```

**Status:** `200 OK` on success

---

### POST /api/programs/create-from-impls

Create a new PROGRAM manifest from selected IMPLs.

**Request body:**
```json
{
  "title": "Auth System",
  "impl_slugs": ["oauth", "session-mgmt"]
}
```

**Response:**
```json
{"status": "ok", "slug": "auth-system"}
```

**Status:** `200 OK` on success

---

### GET /api/program/{slug}

Get program status with tier completion details.

**Path params:**
- `slug` -- Program slug

**Response:**
```json
{
  "slug": "ecommerce",
  "title": "E-commerce Platform",
  "tiers": [
    {"tier": 1, "impls": ["oauth", "users"], "status": "complete"},
    {"tier": 2, "impls": ["payments", "inventory"], "status": "in_progress"}
  ]
}
```

**Status:** `200 OK` on success, `404` if not found

---

### GET /api/program/{slug}/tier/{n}

Get detailed status for a specific tier.

**Path params:**
- `slug` -- Program slug
- `n` -- Tier number

**Response:**
```json
{
  "tier": 1,
  "impls": [...],
  "status": "complete"
}
```

**Status:** `200 OK` on success, `404` if tier not found

---

### POST /api/program/{slug}/tier/{n}/execute

Execute all IMPLs in a tier (triggers Scout/Wave for each).

**Path params:**
- `slug` -- Program slug
- `n` -- Tier number

**Response:**
```json
{"status": "executing"}
```

**Status:** `200 OK` on success, `409` if already executing

---

### GET /api/program/{slug}/contracts

Get cross-IMPL interface contracts for a program.

**Path params:**
- `slug` -- Program slug

**Response:**
```json
{
  "contracts": [...]
}
```

**Status:** `200 OK` on success

---

### POST /api/program/{slug}/replan

Re-plan a program (re-analyze dependencies and reorder tiers).

**Path params:**
- `slug` -- Program slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### GET /api/program/events

SSE stream for program-level events (tier completion, IMPL status changes).

**Response:** `text/event-stream`

**Events:**
- `program_updated` -- Program state changed
- `tier_complete` -- A tier finished execution

---

## Autonomy Layer

### GET /api/pipeline

Get the full autonomy pipeline state (queue, daemon status, active executions).

**Query params:**
- `include_completed` -- Set to `true` to include completed items (optional)

**Response:**
```json
{
  "queue": [...],
  "daemon_running": true,
  "active_execution": "oauth"
}
```

**Status:** `200 OK` always

---

### GET /api/queue

List the current execution queue.

**Response:**
```json
{
  "items": [
    {"slug": "oauth", "priority": 1, "status": "pending"},
    {"slug": "caching", "priority": 2, "status": "pending"}
  ]
}
```

**Status:** `200 OK` always

---

### POST /api/queue

Add an item to the execution queue.

**Request body:**
```json
{
  "slug": "oauth",
  "priority": 1
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### DELETE /api/queue/{slug}

Remove an item from the execution queue.

**Path params:**
- `slug` -- IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `404` if not found

---

### PUT /api/queue/{slug}/priority

Change the priority of a queue item.

**Path params:**
- `slug` -- IMPL doc slug

**Request body:**
```json
{
  "priority": 3
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### GET /api/autonomy

Get autonomy settings (auto-execute, concurrency limits, etc.).

**Response:**
```json
{
  "enabled": true,
  "max_concurrent": 1,
  "auto_merge": false
}
```

**Status:** `200 OK` always

---

### PUT /api/autonomy

Update autonomy settings.

**Request body:** Same structure as GET response

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

## Daemon Operations

### POST /api/daemon/start

Start the background execution daemon (processes queue automatically).

**Response:**
```json
{"status": "started"}
```

**Status:** `200 OK` on success, `409` if already running

---

### POST /api/daemon/stop

Stop the background execution daemon.

**Response:**
```json
{"status": "stopped"}
```

**Status:** `200 OK` on success

---

### GET /api/daemon/status

Get current daemon status.

**Response:**
```json
{
  "running": true,
  "uptime_seconds": 3600,
  "current_task": "oauth"
}
```

**Status:** `200 OK` always

---

### GET /api/daemon/events

SSE stream for daemon events (task started, completed, errors).

**Response:** `text/event-stream`

**Events:**
- `daemon_started` -- Daemon started
- `daemon_stopped` -- Daemon stopped
- `task_started` -- Daemon picked up a queue item
- `task_complete` -- Queue item finished
- `task_failed` -- Queue item failed

---

## Interview Operations

### POST /api/interview/start

Start an interactive interview session to refine a feature description before Scout.

**Request body:**
```json
{
  "feature": "Add user authentication",
  "backend": "auto"
}
```

**Response:**
```json
{
  "run_id": "1773031123005120000"
}
```

**Status:** `200 OK` on success

---

### GET /api/interview/{runID}/events

SSE stream for interview questions and progress.

**Path params:**
- `runID` -- Run ID from interview start

**Response:** `text/event-stream`

**Events:**
- `interview_question` -- A question for the user
- `interview_complete` -- Interview finished, feature refined
- `interview_failed` -- Interview failed

---

### POST /api/interview/{runID}/answer

Submit an answer to an interview question.

**Path params:**
- `runID` -- Run ID from interview start

**Request body:**
```json
{
  "answer": "We need OAuth 2.0 with PKCE for SPAs"
}
```

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### POST /api/interview/{runID}/cancel

Cancel an in-progress interview.

**Path params:**
- `runID` -- Run ID from interview start

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` if cancelled, `404` if not found

---

## Observability Operations

### GET /api/observability/metrics/{impl_slug}

Get observability metrics for an IMPL (agent durations, token usage, success rates).

**Path params:**
- `impl_slug` -- IMPL doc slug

**Response:**
```json
{
  "impl_slug": "oauth",
  "total_duration_seconds": 1200,
  "total_tokens": 50000,
  "agent_metrics": [...]
}
```

**Status:** `200 OK` on success, `500` if observability store not configured

---

### GET /api/observability/metrics/program/{program_slug}

Get aggregated observability metrics for a program.

**Path params:**
- `program_slug` -- Program slug

**Response:**
```json
{
  "program_slug": "ecommerce",
  "total_cost": 12.50,
  "impl_summaries": [...]
}
```

**Status:** `200 OK` on success

---

### GET /api/observability/events

Query observability events with filters.

**Query params:**
- `type` -- Event type filter (optional)
- `impl` -- IMPL slug filter (optional)
- `program` -- Program slug filter (optional)
- `agent` -- Agent ID filter (optional)
- `start_time` -- Start time in RFC3339 format (optional)
- `end_time` -- End time in RFC3339 format (optional)
- `limit` -- Max results (optional)
- `offset` -- Pagination offset (optional)

**Response:**
```json
{
  "events": [...]
}
```

**Status:** `200 OK` on success

---

### GET /api/observability/rollup

Get aggregated rollup of observability data.

**Query params:**
- `type` -- Event type filter (optional)
- `group_by` -- Grouping key (optional)
- `impl` -- IMPL slug filter (optional)
- `program` -- Program slug filter (optional)
- `start_time` -- Start time in RFC3339 format (optional)
- `end_time` -- End time in RFC3339 format (optional)

**Response:**
```json
{
  "rollups": [...]
}
```

**Status:** `200 OK` on success

---

### GET /api/observability/cost-breakdown/{impl_slug}

Get cost breakdown for an IMPL (per-agent, per-wave costs).

**Path params:**
- `impl_slug` -- IMPL doc slug

**Response:**
```json
{
  "impl_slug": "oauth",
  "total_cost": 5.25,
  "by_wave": [...],
  "by_agent": [...]
}
```

**Status:** `200 OK` on success

---

## File Browser Operations

### GET /api/files/tree

Browse file tree of a repository.

**Query params:**
- `repo` -- Repository name (optional)
- `path` -- Relative path within repo (optional)

**Response:**
```json
{
  "entries": [
    {"name": "pkg", "type": "dir"},
    {"name": "main.go", "type": "file", "size": 1234}
  ]
}
```

**Status:** `200 OK` on success

---

### GET /api/files/read

Read file contents from a repository.

**Query params:**
- `repo` -- Repository name (optional)
- `path` -- Relative file path (required)

**Response:**
```json
{
  "content": "package main\n\nimport...",
  "path": "main.go"
}
```

**Status:** `200 OK` on success, `404` if file not found

---

### GET /api/files/diff

Get git diff for a file.

**Query params:**
- `repo` -- Repository name (optional)
- `path` -- Relative file path (required)

**Response:**
```json
{
  "diff": "@@ -1,5 +1,8 @@\n..."
}
```

**Status:** `200 OK` on success

---

### GET /api/files/status

Get git status for files in a repository.

**Query params:**
- `repo` -- Repository name (optional)

**Response:**
```json
{
  "files": [
    {"path": "pkg/new.go", "status": "added"},
    {"path": "pkg/old.go", "status": "modified"}
  ]
}
```

**Status:** `200 OK` on success

---

## Static Assets

### GET /

Serves the embedded React web UI. All non-API routes fall through to the single-page app (SPA) router.

---

## Error Responses

All endpoints return errors in consistent format:

**400 Bad Request:**
```json
{"error": "missing slug parameter"}
```

**404 Not Found:**
```json
{"error": "IMPL doc not found: oauth"}
```

**409 Conflict:**
```json
{"error": "wave 2 already running"}
```

**500 Internal Server Error:**
```json
{"error": "failed to parse manifest: ..."}
```

---

## SSE Event Format

All SSE endpoints follow this pattern:

```
event: event_name
data: {"key": "value"}

```

**Example stream:**
```
event: wave_started
data: {"wave": 1, "agents": ["A", "B"]}

event: agent_output
data: {"wave": 1, "agent": "A", "line": "Starting..."}

event: wave_complete
data: {"wave": 1, "status": "complete"}
```

**Client example:**
```javascript
const es = new EventSource('/api/wave/oauth/events');
es.addEventListener('wave_started', (e) => {
  const data = JSON.parse(e.data);
  console.log('Wave', data.wave, 'started');
});
```

---

## Authentication

Currently, the API has no authentication. It's intended for local development only. Do not expose `saw serve` to untrusted networks.

---

## Rate Limiting

No rate limiting. All operations are synchronous or streamed.

---

## See Also

- [CLI Reference](cli-reference.md) -- Command-line interface
- [Configuration Reference](configuration.md) -- `saw.config.json` structure
- [Protocol Specification](https://github.com/blackwell-systems/scout-and-wave) -- SAW protocol invariants
