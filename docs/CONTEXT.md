# Project Context

## Build & Test Commands

**Correct commands for IMPL docs in this repo:**
```
test_command: go test ./... && cd /Users/dayna.blackwell/code/scout-and-wave-web/web && node_modules/.bin/vitest run
lint_command: go vet ./...
```

- Frontend uses **Vitest**, not Jest. Do NOT use `npm test -- --watchAll=false` — `--watchAll` is a Jest-only flag that Vitest rejects with `CACError: Unknown option`.
- Use `node_modules/.bin/vitest run` for a single-pass frontend test run.
- Go tests: `go test ./...`

## Features Completed
- **yaml-structured-sections-v3**: completed 2026-03-10, 0 waves, 0 agents
  - IMPL doc: ../scout-and-wave/docs/IMPL/IMPL-yaml-structured-sections-v3.yaml
- **yaml-structured-sections-v3**: completed 2026-03-10, 0 waves, 0 agents
  - IMPL doc: ../scout-and-wave/docs/IMPL/IMPL-yaml-structured-sections-v3.yaml
- **live-execution-viz**: completed 2026-03-15, 2 waves, 5 agents
  - IMPL doc: docs/IMPL/complete/IMPL-live-execution-viz.yaml
- **usereducer-wave-events**: completed 2026-03-16, 2 waves, 2 agents
  - IMPL doc: docs/IMPL/IMPL-usereducer-wave-events.yaml
- **live-file-activity**: completed 2026-03-17, 1 waves, 2 agents
  - IMPL doc: docs/IMPL/IMPL-live-file-activity.yaml
- **autonomy-web-ui**: completed 2026-03-17, 2 waves, 6 agents
  - IMPL doc: docs/IMPL/IMPL-autonomy-web-ui.yaml
- **external-wave-event-store**: completed 2026-03-18, 2 waves, 2 agents
  - IMPL doc: docs/IMPL/IMPL-external-wave-event-store.yaml
- **notification-system**: completed 2026-03-18, 2 waves, 4 agents
  - IMPL doc: docs/IMPL/IMPL-notification-system.yaml
- **program-layer-web-integration**: completed 2026-03-18, 2 waves, 6 agents
  - IMPL doc: docs/IMPL/IMPL-program-layer-web-integration.yaml
- **pipeline-program-hardening**: completed 2026-03-19, 2 waves, 7 agents
  - IMPL doc: docs/IMPL/complete/IMPL-pipeline-program-hardening.yaml
- **format-gate**: completed 2026-03-19, 1 waves, 4 agents
  - IMPL doc: docs/IMPL/complete/IMPL-format-gate.yaml
- **protocol-engine-drift-fixes**: completed 2026-03-19, 2 waves, 6 agents
  - IMPL doc: docs/IMPL/complete/IMPL-protocol-engine-drift-fixes.yaml
- **auto-fix-failures**: completed 2026-03-19, 1 waves, 4 agents
  - IMPL doc: docs/IMPL/complete/IMPL-auto-fix-failures.yaml
- **reactions-system**: completed 2026-03-19, 2 waves, 5 agents
  - IMPL doc: docs/IMPL/complete/IMPL-reactions-system.yaml
- **integration-gap-solution**: completed 2026-03-19, 3 waves, 7 agents
  - IMPL doc: docs/IMPL/complete/IMPL-integration-gap-solution.yaml
- **ai-code-review-gate**: completed 2026-03-19, 2 waves, 5 agents
  - IMPL doc: docs/IMPL/complete/IMPL-ai-code-review-gate.yaml
- **living-impl-docs**: completed 2026-03-19, 2 waves, 6 agents
  - IMPL doc: docs/IMPL/complete/IMPL-living-impl-docs.yaml
- **sse-improvements**: completed 2026-03-19, 1 waves, 5 agents
  - IMPL doc: docs/IMPL/complete/IMPL-sse-improvements.yaml
