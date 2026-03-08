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
