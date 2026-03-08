# IMPL: Protocol Loop — Completion Report Polling Fix

## Summary

Fixes the circular dependency in the SAW orchestrator where `launchAgent` polled
the main repo IMPL doc for agent completion reports, but agents write their reports
into the worktree copy of that file. The two paths never matched until after merge,
which itself requires completion first.

---

### Agent A - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-A
branch: saw/wave1-agent-A
commit: b840d5af604c632ead72312a9f1bfa618a7846cd
files_changed:
  - pkg/orchestrator/orchestrator.go
  - pkg/orchestrator/orchestrator_test.go
files_created: []
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestWtIMPLPath (table-driven: standard nested path, IMPL at repo root, deeper nesting)
  - TestWtIMPLPath_Fallback (platform-safe fallback verification)
  - TestLaunchAgent_PollsWorktreeIMPLDoc (spy verifies worktree path reaches waitForCompletionFunc)
verification: PASS (go build ./..., go vet ./..., go test ./pkg/orchestrator/...)
```

**Key decisions:**

- `wtIMPLPath` uses `filepath.Rel(repoPath, implDocPath)` to extract the path
  segment relative to the repo root, then `filepath.Join(wtPath, rel)` to
  reconstruct it under the worktree root. Fallback to `implDocPath` on `Rel`
  error preserves safe behaviour on Windows cross-drive paths.

- The call site change is minimal: one argument to `waitForCompletionFunc` in
  `launchAgent`, after `wtPath` is known from `worktreeCreatorFunc`.

- `TestLaunchAgent_PollsWorktreeIMPLDoc` uses a spy closure replacing
  `waitForCompletionFunc` to record the `implDocPath` argument, then asserts
  it matches the worktree path and explicitly asserts it does NOT equal the main
  repo path — covering both the positive and negative invariants.

- `path/filepath` was added to imports in both `.go` files.

**No downstream action required.** The fix is self-contained within `launchAgent`
and the new helper. `WaitForCompletion` in `pkg/agent/completion.go` is unchanged.

---

# IMPL: Protocol Loop — Wave Gate & Control Endpoints

This document tracks the wave gate mechanism and control endpoint additions to the SAW server.

---

### Agent C - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-C
branch: saw/wave1-agent-C
commit: 8f7e83599216bb410c9b50c953573c441c7f4b86
files_changed:
  - pkg/api/wave_runner.go
files_created: []
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (go build ./..., go vet ./..., go test ./pkg/api/...)
```

**Implementation notes:**

1. `gateChannels sync.Map` — package-level, keyed by slug, values are `chan bool` (buffered 1). Created fresh per gate crossing, deleted after use in all code paths (proceed, cancel, timeout).

2. `runWaveLoop` gate logic — inserted after `UpdateIMPLStatus` for each wave except the last (`i < len(waves)-1`). Uses a `select` with a 30-minute `time.After` timeout. Publishes `wave_gate_pending` before blocking, `wave_gate_resolved` on true, `run_failed` on false or timeout.

3. `handleWaveGateProceed` — looks up slug in `gateChannels`, type-asserts to `chan bool`, does a non-blocking send of `true`. Returns 404 if no gate is pending for the slug (prevents silent no-ops on stale requests). Returns 202 on success.

4. `handleWaveAgentRerun` — stub only. Parses `slug` and `letter` from path values, returns 202 with a JSON body noting the stub status. Full implementation (re-spawning worktree, re-running agent, updating IMPL doc) is deferred.

**downstream_action_required: true**

The orchestrator must add the following route registrations to `pkg/api/server.go` in the `New()` function, after the existing `POST /api/wave/{slug}/start` line:

```go
s.mux.HandleFunc("POST /api/wave/{slug}/gate/proceed", s.handleWaveGateProceed)
s.mux.HandleFunc("POST /api/wave/{slug}/agent/{letter}/rerun", s.handleWaveAgentRerun)
```

**handleWaveAgentRerun follow-up required:** The stub returns 202 but performs no action. A follow-up task should implement: locating the agent's worktree, re-invoking the agent subprocess, collecting the new completion report, and updating IMPL doc status.
