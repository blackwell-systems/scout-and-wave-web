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
| `/api/impl/{slug}/raw` | GET | IMPL Docs | Get raw IMPL doc content |
| `/api/impl/{slug}/raw` | PUT | IMPL Docs | Update raw IMPL doc |
| `/api/impl/{slug}/approve` | POST | Review | Mark IMPL as approved |
| `/api/impl/{slug}/reject` | POST | Review | Mark IMPL as rejected |
| `/api/impl/{slug}/diff/{agent}` | GET | Review | Get file diffs for agent |
| `/api/scout/run` | POST | Scout | Run Scout agent |
| `/api/scout/{slug}/rerun` | POST | Scout | Re-run Scout for existing IMPL |
| `/api/scout/{runID}/events` | GET (SSE) | Scout | Scout execution event stream |
| `/api/scout/{runID}/cancel` | POST | Scout | Cancel running Scout |
| `/api/wave/{slug}/start` | POST | Wave | Start wave execution |
| `/api/wave/{slug}/events` | GET (SSE) | Wave | Wave execution event stream |
| `/api/wave/{slug}/state` | GET | Wave | Get current wave state |
| `/api/wave/{slug}/merge` | POST | Wave | Merge completed wave |
| `/api/wave/{slug}/test` | POST | Wave | Run post-merge tests |
| `/api/wave/{slug}/gate/proceed` | POST | Wave | Proceed past quality gate |
| `/api/wave/{slug}/agent/{letter}/rerun` | POST | Wave | Re-run specific agent |
| `/api/git/{slug}/activity` | GET | Git | Get git activity for IMPL |
| `/api/impl/{slug}/worktrees` | GET | Worktrees | List worktrees for IMPL |
| `/api/impl/{slug}/worktrees/{branch}` | DELETE | Worktrees | Delete specific worktree |
| `/api/impl/{slug}/worktrees/cleanup` | POST | Worktrees | Batch delete worktrees |
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
| `/api/manifest/{slug}` | GET | Manifest | Load YAML manifest |
| `/api/manifest/{slug}/validate` | POST | Manifest | Validate manifest |
| `/api/manifest/{slug}/wave/{number}` | GET | Manifest | Get specific wave |
| `/api/manifest/{slug}/completion/{agentID}` | POST | Manifest | Set completion report |
| `/api/journal/{wave}/{agent}` | GET | Journal | Get tool usage journal |
| `/api/journal/{wave}/{agent}/summary` | GET | Journal | Get journal summary |
| `/api/journal/{wave}/{agent}/checkpoints` | GET | Journal | List journal checkpoints |
| `/api/journal/{wave}/{agent}/restore` | POST | Journal | Restore from checkpoint |

---

## Global Events

### GET /api/events

Global SSE stream for server-wide events (e.g., IMPL list updates).

**Response:** `text/event-stream`

**Events:**
- `impl_list_updated` — IMPL directory changed (new/modified/deleted files)
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
- `slug` — Filename without `IMPL-` prefix and extension
- `status` — `pending`, `suitable`, `not-suitable`, `in-progress`, `complete`
- `format` — `markdown` or `yaml`

---

### GET /api/impl/{slug}

Get parsed IMPL doc with full wave/agent details.

**Path params:**
- `slug` — IMPL doc slug (e.g., `oauth` for `IMPL-oauth.yaml`)

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
- `slug` — IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `404` if not found

---

### GET /api/impl/{slug}/raw

Get raw IMPL doc content (markdown or YAML).

**Path params:**
- `slug` — IMPL doc slug

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
- `slug` — IMPL doc slug

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

## Review Operations

### POST /api/impl/{slug}/approve

Mark IMPL doc as approved (sets status to `approved` in metadata).

**Path params:**
- `slug` — IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` always

---

### POST /api/impl/{slug}/reject

Mark IMPL doc as rejected (sets status to `rejected` in metadata).

**Path params:**
- `slug` — IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` always

---

### GET /api/impl/{slug}/diff/{agent}

Get file diffs for a specific agent's worktree.

**Path params:**
- `slug` — IMPL doc slug
- `agent` — Agent letter (e.g., `A`, `B`)

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
- `feature` — Feature description (required)
- `backend` — `api`, `cli`, or `auto` (optional; default: `auto`)

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
- `slug` — IMPL doc slug

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
- `runID` — Run ID from `POST /api/scout/run` response

**Response:** `text/event-stream`

**Events:**
- `scout_output` — Streaming output chunk
  ```json
  {"run_id": "...", "chunk": "Analyzing codebase..."}
  ```
- `scout_complete` — Scout finished successfully
  ```json
  {"run_id": "...", "slug": "oauth", "path": "/path/to/IMPL-oauth.yaml"}
  ```
- `scout_failed` — Scout failed
  ```json
  {"run_id": "...", "error": "Failed to parse..."}
  ```

**Example:**
```javascript
const es = new EventSource(`/api/scout/${runID}/events`);
es.addEventListener('scout_output', (e) => {
  const data = JSON.parse(e.data);
  console.log(data.chunk);
});
es.addEventListener('scout_complete', (e) => {
  const data = JSON.parse(e.data);
  console.log('IMPL created:', data.slug);
});
```

---

### POST /api/scout/{runID}/cancel

Cancel a running Scout agent.

**Path params:**
- `runID` — Run ID from Scout run

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
- `slug` — IMPL doc slug

**Request body:**
```json
{
  "wave_num": 1,
  "auto": true
}
```

**Fields:**
- `wave_num` — Wave number to execute (default: `1`)
- `auto` — Continue automatically after completion (default: `false`)

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
- `slug` — IMPL doc slug

**Response:** `text/event-stream`

**Events:**
- `wave_started` — Wave execution began
  ```json
  {"wave": 1, "agents": ["A", "B"]}
  ```
- `agent_status` — Agent status changed
  ```json
  {"wave": 1, "agent": "A", "status": "running"}
  ```
- `agent_output` — Agent stdout/stderr line
  ```json
  {"wave": 1, "agent": "A", "line": "Processing file..."}
  ```
- `agent_complete` — Agent finished
  ```json
  {"wave": 1, "agent": "A", "status": "complete"}
  ```
- `agent_failed` — Agent failed
  ```json
  {"wave": 1, "agent": "A", "error": "Build failed"}
  ```
- `wave_complete` — All agents in wave finished
  ```json
  {"wave": 1, "status": "complete"}
  ```
- `merge_started` — Merge operation began
  ```json
  {"wave": 1}
  ```
- `merge_complete` — Merge succeeded
  ```json
  {"wave": 1, "status": "merged"}
  ```
- `merge_failed` — Merge failed
  ```json
  {"wave": 1, "error": "Conflict in file..."}
  ```
- `run_complete` — All waves finished
  ```json
  {"status": "success", "waves": 3, "agents": 8}
  ```
- `run_failed` — Wave run failed
  ```json
  {"error": "Wave 2 failed: Agent C blocked"}
  ```

**Example:**
```javascript
const es = new EventSource(`/api/wave/oauth/events`);
es.addEventListener('agent_output', (e) => {
  const data = JSON.parse(e.data);
  console.log(`[${data.agent}] ${data.line}`);
});
```

---

### GET /api/wave/{slug}/state

Get current wave state machine status.

**Path params:**
- `slug` — IMPL doc slug

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

### POST /api/wave/{slug}/merge

Manually trigger merge for a completed wave.

**Path params:**
- `slug` — IMPL doc slug

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

### POST /api/wave/{slug}/test

Run post-merge test suite for a wave.

**Path params:**
- `slug` — IMPL doc slug

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
- `slug` — IMPL doc slug

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success

---

### POST /api/wave/{slug}/agent/{letter}/rerun

Re-run a specific agent in a wave (recovery tool).

**Path params:**
- `slug` — IMPL doc slug
- `letter` — Agent letter (e.g., `A`, `B`)

**Response:**
```json
{"status": "rerunning"}
```

**Status:** `200 OK` on success, `404` if agent not found

---

## Git Operations

### GET /api/git/{slug}/activity

Get recent git activity related to an IMPL doc (commits, branches).

**Path params:**
- `slug` — IMPL doc slug

**Response:**
```json
{
  "commits": [
    {
      "hash": "a1b2c3d",
      "message": "Wave 1: Implement OAuth client (Agent A)",
      "author": "alice@example.com",
      "date": "2026-03-11T10:30:00Z"
    }
  ],
  "branches": [
    "wave-1-agent-A",
    "wave-1-agent-B"
  ]
}
```

**Status:** `200 OK` on success

---

## Worktree Management

### GET /api/impl/{slug}/worktrees

List all worktrees associated with an IMPL doc.

**Path params:**
- `slug` — IMPL doc slug

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
- `slug` — IMPL doc slug
- `branch` — Branch name (e.g., `wave-1-agent-A`)

**Response:**
```json
{"status": "ok"}
```

**Status:** `200 OK` on success, `404` if not found

---

### POST /api/impl/{slug}/worktrees/cleanup

Batch delete worktrees for completed waves.

**Path params:**
- `slug` — IMPL doc slug

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

## Chat Operations

### POST /api/impl/{slug}/chat

Start a chat session with Claude about an IMPL doc.

**Path params:**
- `slug` — IMPL doc slug

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
- `message` — User message (required)
- `history` — Previous conversation turns (optional)

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
- `slug` — IMPL doc slug
- `runID` — Run ID from chat request

**Response:** `text/event-stream`

**Events:**
- `chat_output` — Response chunk
  ```json
  {"run_id": "...", "chunk": "Agent B implements..."}
  ```
- `chat_complete` — Response finished
  ```json
  {"run_id": "...", "slug": "oauth"}
  ```
- `chat_failed` — Chat failed
  ```json
  {"run_id": "...", "error": "API error"}
  ```

---

## Revise Operations

### POST /api/impl/{slug}/revise

Request AI revision of an IMPL doc based on feedback.

**Path params:**
- `slug` — IMPL doc slug

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
- `slug` — IMPL doc slug
- `runID` — Run ID from revise request

**Response:** `text/event-stream`

**Events:**
- `revise_output` — Progress update
  ```json
  {"run_id": "...", "chunk": "Analyzing wave dependencies..."}
  ```
- `revise_complete` — Revision finished
  ```json
  {"run_id": "...", "slug": "oauth"}
  ```
- `revise_failed` — Revision failed
  ```json
  {"run_id": "...", "error": "..."}
  ```

---

### POST /api/impl/{slug}/revise/{runID}/cancel

Cancel an in-progress revision.

**Path params:**
- `slug` — IMPL doc slug
- `runID` — Run ID from revise request

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
- `slug` — IMPL doc slug

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
- `slug` — IMPL doc slug
- `letter` — Agent letter (e.g., `A`, `B`)

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

## Manifest Operations

### GET /api/manifest/{slug}

Load and parse a YAML IMPL manifest.

**Path params:**
- `slug` — IMPL doc slug

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
- `slug` — IMPL doc slug

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
- `slug` — IMPL doc slug
- `number` — Wave number

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
- `slug` — IMPL doc slug
- `agentID` — Agent ID (e.g., `A`, `B`)

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
- `wave` — Wave number
- `agent` — Agent letter

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
- `wave` — Wave number
- `agent` — Agent letter

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
- `wave` — Wave number
- `agent` — Agent letter

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
- `wave` — Wave number
- `agent` — Agent letter

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

- [CLI Reference](cli-reference.md) — Command-line interface
- [Configuration Reference](configuration.md) — `saw.config.json` structure
- [Protocol Specification](https://github.com/blackwell-systems/scout-and-wave) — SAW protocol invariants
