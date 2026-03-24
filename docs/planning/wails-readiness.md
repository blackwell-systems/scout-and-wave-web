# Wails Portability Readiness

**Audience:** Developers planning a future native desktop port using [Wails v2/v3](https://wails.io).
**Scope:** `scout-and-wave-web` frontend and `pkg/api` backend layer; references `scout-and-wave-go` engine where relevant.
**Rule:** Every recommendation must leave the existing web app working and strictly better — no Wails imports, no speculative abstractions.

---

## Executive Summary

The five highest-leverage changes, in priority order:

1. **Extract `runWaveLoop` / `runFinalizeSteps` / `runScoutAgent` into a service layer** (`pkg/svc/`). These ~600-line functions contain the entire execution lifecycle but live inside `pkg/api/`, making them impossible to call without an HTTP server. Moving them to a pure Go package is the single change with the highest Wails payoff and the lowest risk. **Effort: 2–3 days.**

2. **Replace hardcoded `new EventSource(...)` calls in hooks with a thin transport interface.** The three core hooks (`useWaveEvents`, `useNotifications`, `usePipeline`) wire directly to SSE URLs. Wrapping them behind a `subscribe(topic)` abstraction would let a Wails adapter swap in Go→JS event binding with no component changes. **Effort: 1 day.**

3. **Consolidate the three separate API client modules** (`api.ts`, `programApi.ts`, `autonomyApi.ts`) behind a single `client` object or factory. Today each module hard-codes `/api/...` paths. A single seam makes it trivial to swap HTTP for Wails RPC. **Effort: half a day; largely mechanical.**

4. **Move the `SAWConfig`-reading logic out of individual HTTP handlers** (`wave_runner.go:109`, `scout.go:193`, etc.) and into a `ConfigService` called once at startup or on demand. Handlers re-read `saw.config.json` from disk on every request. A shared service would be cheaper for HTTP and essential for Wails, which has no per-request lifecycle. **Effort: 1 day.**

5. **Adopt `fsnotify` event callbacks instead of polling in `usePipeline`** — already done on the server side; the hook still opens its own redundant `/api/events` SSE stream alongside the one in `App.tsx`. Deduplicate by lifting the global SSE connection to a React context. Improves the web app today and maps directly to Wails `runtime.EventsOn`. **Effort: half a day.**

---

## Current Architecture Assessment

### How the web app is structured today

```
React UI
  └─ api.ts / programApi.ts / autonomyApi.ts   ← HTTP fetch wrappers (transport layer)
  └─ hooks/useWaveEvents.ts                     ← SSE subscriber → reducer → state
  └─ hooks/useNotifications.ts                  ← SSE subscriber → toast/notification state
  └─ hooks/useDaemon.ts                         ← HTTP fetch + SSE subscriber → daemon state
  └─ hooks/usePipeline.ts                       ← HTTP fetch + SSE subscriber → pipeline state
  └─ hooks/useFileBrowser.ts                    ← HTTP fetch → file tree state
  └─ App.tsx                                    ← global SSE connection, top-level state

pkg/api/server.go                               ← Route registration; owns all broker fields
pkg/api/wave_runner.go                          ← runWaveLoop, runFinalizeSteps (heavy logic)
pkg/api/scout.go                                ← runScoutAgent (heavy logic)
pkg/api/program_runner.go                       ← runProgramTier (heavy logic)
pkg/api/daemon_handler.go                       ← daemon start/stop + SSE broker
pkg/api/global_events.go                        ← fsnotify watcher, global SSE broker
pkg/api/notification_bus.go                     ← NotificationBus → globalBroker

scout-and-wave-go/pkg/engine/                   ← Pure Go engine; returns engine.Event callbacks
scout-and-wave-go/pkg/protocol/                 ← IMPL manifest I/O, validators, mergers
```

### What is already well-separated

- **`scout-and-wave-go` is entirely transport-agnostic.** `engine.RunSingleWave`, `engine.RunScout`, `protocol.MergeAgents`, etc. accept a callback (`func(engine.Event)`) and never touch HTTP or SSE. This is the ideal design.
- **The API client layer is centralized in three files.** There are no `fetch('/api/...')` calls scattered through components; components call named functions from `api.ts`, `programApi.ts`, or `autonomyApi.ts`.
- **React hooks encapsulate SSE subscriptions.** Components never call `new EventSource(...)` directly. The SSE wiring lives in `useWaveEvents.ts`, `useNotifications.ts`, `useDaemon.ts`, and `usePipeline.ts`.
- **The reducer pattern in `waveEventsReducer.ts` is pure.** State transitions are pure functions of actions with no transport dependencies — they would work identically with Wails events.
- **`browse_handler.go` calls native OS APIs only on the server side** and already has a `501 Not Implemented` branch for non-macOS. Wails has a native folder picker built in and can replace this endpoint entirely.

---

## The Wails Portability Gap

Wails replaces the following components of the web app:

| Web app component | Wails equivalent |
|---|---|
| HTTP server (`net/http`, `golang.org/x/net/http2`) | Wails app binary — no TCP server |
| SSE (`text/event-stream`) | `runtime.EventsEmit(ctx, name, data)` (Go→JS) |
| `fetch('/api/...')` in TypeScript | `runtime.Call(ctx, "MethodName", args)` bound Go methods |
| `new EventSource('/api/...')` in TypeScript | `runtime.EventsOn(name, callback)` |
| `GET /api/browse/native` (osascript) | `runtime.OpenDirectoryDialog` |
| `os.ReadFile(saw.config.json)` per-request | One-time read at app init; file watch via `fsnotify` |
| `//go:embed dist` | Wails `frontend/` with its own dev server |

The key implication: **every `http.ResponseWriter`-using handler must be replaced by a Go method with a return value**; every `s.broker.Publish(...)` call must become a `runtime.EventsEmit(...)` call. None of this requires changing the engine or protocol layer.

The structural difficulty is that `runWaveLoop` and `runScoutAgent` are currently buried inside `pkg/api/` and receive a `publish func(event string, data interface{})` closure wired to an `sseBroker`. That closure is the only thing that needs to change to support Wails — but today it cannot be reached without instantiating a `Server`.

---

## Recommended Changes, Ranked by Impact/Effort

### R1. Extract execution logic into `pkg/svc/` (highest leverage)

**What:** Create `pkg/svc/execution.go` containing `RunWave(ctx, opts, publish)` and `pkg/svc/scout.go` containing `RunScout(ctx, opts, publish)`. The existing `pkg/api/wave_runner.go:runWaveLoop` (lines 87–369) and `pkg/api/scout.go:runScoutAgent` (lines 160–279) become thin wrappers that call into `pkg/svc/`.

The `publish func(event string, data interface{})` signature already exists as the seam — it just needs to be callable from outside `pkg/api/`.

**Why it helps Wails:** A Wails binding can call `svc.RunWave(ctx, opts, func(event, data) { runtime.EventsEmit(...) })` directly without any HTTP handler.

**Why it doesn't hurt the web app:** `pkg/api/` keeps its existing handlers; they just delegate to `pkg/svc/` rather than containing the logic. The behavior is identical — the only change is the package boundary.

**Files to change:**
- Create `pkg/svc/execution.go` — move `runWaveLoop`, `runFinalizeSteps`, `runFinalizeStepsFunc` seam
- Create `pkg/svc/scout.go` — move `runScoutAgent`
- Thin wrapper in `pkg/api/wave_runner.go` (handler stays, body calls `svc.RunWave`)
- Thin wrapper in `pkg/api/scout.go` (handler stays, body calls `svc.RunScout`)

**Rough effort:** 2–3 days (the functions have many callsites through internal state like `defaultPipelineTracker` and `fallbackSAWConfig` that must be passed explicitly rather than read from package-level vars).

---

### R2. Replace `new EventSource(...)` with a transport hook (second-highest leverage)

**What:** Introduce a `createEventSource(url: string): EventSource`-like factory, or a simple React context `EventSourceContext`, that hooks use instead of calling `new EventSource(...)` directly.

Currently:
- `useWaveEvents.ts:79` — `new EventSource(\`/api/wave/${slug}/events\`)`
- `useNotifications.ts:112` — `new EventSource('/api/events')`
- `useDaemon.ts:46` — `subscribeDaemonEvents()` which calls `new EventSource('/api/daemon/events')`
- `usePipeline.ts:54` — `new EventSource('/api/events')` (separate from App.tsx's connection — see R5)

The goal is not to pre-build a Wails adapter. The goal is to ensure the abstraction boundary exists so that in a Wails port, one shim file replaces all SSE consumption.

**Concrete form for the web app:**

```typescript
// web/src/lib/transport.ts
export function openEventStream(url: string): EventSource {
  return new EventSource(url)
}
```

All hooks import `openEventStream` instead of calling `new EventSource(...)`. The web app behavior is 100% identical. In a Wails port, this file is replaced with one that returns a fake `EventSource`-compatible object backed by `runtime.EventsOn`.

**Why it doesn't hurt the web app:** It is a pure refactor with no behavior change.

**Files to change:**
- Create `web/src/lib/transport.ts`
- `web/src/hooks/useWaveEvents.ts:79`
- `web/src/hooks/useNotifications.ts:112`
- `web/src/hooks/useDaemon.ts:45` (via `autonomyApi.ts:subscribeDaemonEvents`)
- `web/src/hooks/usePipeline.ts:54`
- `web/src/autonomyApi.ts:108` (`subscribeDaemonEvents`)
- `web/src/api.ts:66` (`subscribeScoutEvents`), `:148` (`subscribeReviseEvents`), `:310` (`subscribeChatEvents`)
- `web/src/programApi.ts:83` (`subscribePlannerEvents`)

**Rough effort:** 1 day.

---

### R3. Unify the three API client modules (medium leverage, low effort)

**What:** `api.ts`, `programApi.ts`, and `autonomyApi.ts` each contain standalone `fetch('/api/...')` calls with no shared base URL and no way to swap the transport. Consolidate them behind a single `apiClient` object:

```typescript
// web/src/lib/client.ts
export const apiClient = {
  listImpls: () => fetch('/api/impl').then(...),
  runScout: (feature, repo) => fetch('/api/scout/run', {...}).then(...),
  // ...
}
```

The existing named exports (`listImpls`, `runScout`) become re-exports from `client.ts` for zero breakage. In a Wails port, `client.ts` is reimplemented using `window.go.api.*` bindings — no component changes required.

**Why it helps Wails:** Wails exposes Go methods as `window.go.PackageName.MethodName(args)`. All callsites only need to change in one file.

**Why it doesn't hurt the web app:** The public API (`import { listImpls } from '../api'`) is unchanged.

**Files to change:** Create `web/src/lib/client.ts`; `api.ts`, `programApi.ts`, `autonomyApi.ts` re-export from it.

**Rough effort:** Half a day; mostly mechanical search-and-restructure.

---

### R4. Centralize `SAWConfig` reads into a `ConfigService` (medium leverage)

**What:** `saw.config.json` is read from disk inside:
- `wave_runner.go:109` — `runWaveLoop` reads it for model names
- `wave_runner.go:739` — `handleWaveAgentRerun` reads it
- `wave_runner.go:820` — `handleWaveFinalize` reads it
- `scout.go:193` — `runScoutAgent` reads it
- `planner.go` — likely similar

Each read is a `os.ReadFile` + `json.Unmarshal` + field extraction. There is also `fallbackSAWConfig` (a package-level var), which is a partial attempt at caching.

**Concrete form:**

```go
// pkg/svc/config.go
type ConfigService struct { mu sync.RWMutex; cfg SAWConfig; path string }
func (c *ConfigService) Get() SAWConfig { ... }
func (c *ConfigService) Reload() error { ... }
```

The `Server` struct holds one `*ConfigService` and passes it to the svc-layer functions instead of re-reading the file.

**Why it helps Wails:** In Wails there is no per-request lifecycle; shared services are the correct pattern. A config change triggers a reload, not a next-request read.

**Why it doesn't hurt the web app:** The behavior is strictly better — fewer disk reads, no stale reads between a save and the next handler invocation.

**Files to change:** `pkg/api/server.go` (add field), `pkg/api/wave_runner.go`, `pkg/api/scout.go`, potentially `pkg/api/planner.go`.

**Rough effort:** 1 day.

---

### R5. Deduplicate the global SSE connection with a React context (low effort, immediate web app improvement)

**What:** `App.tsx` opens one `EventSource('/api/events')` for `impl_list_updated` events. `usePipeline.ts:54` opens a second independent `EventSource('/api/events')`. `useNotifications.ts:112` opens a third. Each component that mounts creates another HTTP/2 stream to the same endpoint.

Create a `GlobalEventsContext` that opens one `EventSource` at the app root and exposes `addEventListener`/`removeEventListener` via context. All hooks consume it instead of creating their own.

**Why it helps Wails:** `runtime.EventsOn` is not connection-based — multiple calls register multiple callbacks to the same Go event bus. The pattern of "one shared connection + multiple subscribers" maps directly.

**Why it doesn't hurt the web app:** One fewer SSE connection per component mount is a strictly better web app. HTTP/2 multiplexing already helps here, but three connections to the same endpoint is still wasteful.

**Files to change:**
- Create `web/src/contexts/GlobalEventsContext.tsx`
- `web/src/App.tsx` — use context provider
- `web/src/hooks/usePipeline.ts:49–74` — consume context instead of opening own SSE
- `web/src/hooks/useNotifications.ts:111–172` — consume context instead of opening own SSE

**Rough effort:** Half a day.

---

### R6. Document / formalize the `publish` callback contract (low effort, high documentation value)

**What:** The `publish func(event string, data interface{})` signature is the critical seam between Go execution logic and the transport. It appears in:
- `wave_runner.go:88` (`runWaveLoop`)
- `scout.go:160` (`runScoutAgent`)
- `program_runner.go:19` (`runProgramTier`)

Add a Go type alias and a small comment block:

```go
// pkg/svc/types.go
// PublishFunc is the event emission callback used by all long-running
// operations (wave execution, scout, planner, daemon). Callers may
// substitute any implementation: SSE broadcast (web app), Go channel
// (tests), or runtime.EventsEmit (Wails).
type PublishFunc func(event string, data interface{})
```

This is not an interface or abstraction — it's documentation that the seam exists and is intentional.

**Rough effort:** 1 hour.

---

## What to Leave Alone

**The SSE broker pattern (`pkg/api/wave.go:sseBroker`) is fine.** Wails will not use it, but it does not need to be changed now. It is purely server-side code; removing or abstracting it would add complexity to the HTTP path with zero benefit.

**The three separate API client files (`api.ts`, `programApi.ts`, `autonomyApi.ts`) can stay as named exports** even after R3. The consolidation is about adding a shim layer, not merging the files. The named exports callers use today (`import { listImpls } from '../api'`) should not change.

**`pkg/api/embed.go` and the `//go:embed dist` pattern** are web-app-only concerns. Wails has its own frontend embedding mechanism. Don't touch this.

**CORS and middleware** are `net/http`-only concerns. There are none currently (`server.go` registers routes directly on `http.ServeMux` with no middleware chain). This is fine — there is nothing to abstract.

**The `fsnotify` watcher in `global_events.go`** does real work that translates directly to Wails: filesystem change detection → UI notification. The Go logic is fine. Only the broadcast mechanism changes (from `globalBroker.broadcast` to `runtime.EventsEmit`).

**The `pkg/api/types.go` shared types** (`SAWConfig`, `IMPLDocResponse`, etc.) are already transport-agnostic data structures. They can be used by both the HTTP handlers and Wails bindings without modification.

**`handleBrowseNative`** calls `osascript` — macOS-specific. This is intentional and documented in the file. Wails provides `runtime.OpenDirectoryDialog` which is cross-platform. Leave the handler in place for the web app; replace it entirely in the Wails port.

**`waveEventsReducer.ts`** is pure TypeScript with no transport dependencies. Do not touch it. It is the best-architected piece of the frontend and would slot into a Wails port unchanged.

---

## Suggested Migration Path

If a Wails port were undertaken 6 months from now, the recommended order:

**Phase 1 — Before the port starts (do now as normal web app improvements):**
1. Complete R5 (deduplicate global SSE context) — web app benefit, Wails prerequisite
2. Complete R4 (ConfigService) — web app benefit (fewer disk reads)
3. Complete R6 (document `PublishFunc`) — zero risk, sets up Phase 2

**Phase 2 — Service extraction (1 week of focused work):**
4. Complete R1 (extract `pkg/svc/`) — this is the structural prerequisite for the Wails backend
5. Write `pkg/svc/` unit tests that pass a test `PublishFunc` — validates the seam works without HTTP

**Phase 3 — Frontend transport abstraction (1 day):**
6. Complete R2 (transport hook) + R3 (unified client) — these can be done together as the frontend gets ported to Wails's frontend scaffolding

**Phase 4 — Wails port (2–3 weeks):**
7. Create Wails app skeleton; bind `pkg/svc/` methods as Wails app methods
8. Replace `openEventStream(url)` with a Wails `EventsOn`-backed shim
9. Replace `apiClient.method()` with `window.go.api.Method()` calls
10. Replace `handleBrowseNative` with `runtime.OpenDirectoryDialog`
11. Keep `pkg/api/` in place as the HTTP server path; both targets share `pkg/svc/` and `pkg/engine/`

The most important constraint: **steps 1–6 should produce zero behavioral change in the web app.** If any step requires a web app feature regression to proceed, that step is mis-scoped and should be rethought.
