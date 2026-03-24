package api

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"syscall"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// MergeWaveRequest is the JSON body for POST /api/wave/{slug}/merge.
type MergeWaveRequest struct {
	Wave int `json:"wave"`
}

// TestWaveRequest is the JSON body for POST /api/wave/{slug}/test.
type TestWaveRequest struct {
	Wave int `json:"wave"`
}

// mergeWaveFunc is the seam used by handleWaveMerge. Tests can replace this
// to inject a no-op and avoid real git calls in unit tests.
var mergeWaveFunc = func(ctx context.Context, opts engine.RunMergeOpts) error {
	return engine.MergeWave(ctx, opts)
}

// handleWaveMerge handles POST /api/wave/{slug}/merge.
// It guards against concurrent merges for the same slug (returns 409),
// returns 202 immediately, then runs engine.MergeWave in a background
// goroutine and streams progress via the SSE broker.
func (s *Server) handleWaveMerge(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	var req MergeWaveRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Guard: return 409 if a merge is already in progress for this slug.
	if _, loaded := s.mergingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "merge already in progress for this slug", http.StatusConflict)
		return
	}

	implPath, repoPath, resolveErr := s.resolveIMPLPath(slug)
	if resolveErr != nil {
		s.mergingRuns.Delete(slug)
		http.Error(w, resolveErr.Error(), http.StatusNotFound)
		return
	}
	publish := s.makePublisher(slug)
	wave := req.Wave

	w.WriteHeader(http.StatusAccepted)
	s.globalBroker.broadcast("impl_list_updated") // execution started

	go func() {
		defer s.mergingRuns.Delete(slug)
		defer s.globalBroker.broadcast("impl_list_updated") // execution ended

		ctx := context.Background()

		publish("merge_started", map[string]interface{}{
			"slug": slug,
			"wave": wave,
		})

		publish("merge_output", map[string]interface{}{
			"slug":  slug,
			"wave":  wave,
			"chunk": fmt.Sprintf("Merging wave %d agents...\n", wave),
		})

		err := mergeWaveFunc(ctx, engine.RunMergeOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			WaveNum:  wave,
		})
		if err != nil {
			conflictingFiles := extractConflictingFiles(err.Error())
			publish("merge_failed", map[string]interface{}{
				"slug":              slug,
				"wave":              wave,
				"error":             err.Error(),
				"conflicting_files": conflictingFiles,
			})
			return
		}

		// Post-merge: go.mod fixup + worktree cleanup
		if fixed, fixErr := protocol.FixGoModReplacePaths(repoPath); fixErr != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("go.mod fixup warning: %v\n", fixErr)})
		} else if fixed {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": "Auto-corrected go.mod replace paths\n"})
		}

		if cleanupResult, cleanErr := protocol.Cleanup(implPath, wave, repoPath); cleanErr != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("Cleanup warning: %v\n", cleanErr)})
		} else if cleanupResult.IsSuccess() {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("Cleaned up %d worktrees\n", len(cleanupResult.GetData().Agents))})
		}

		publish("merge_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "success",
		})
	}()
}

// handleWaveTest handles POST /api/wave/{slug}/test.
// It guards against concurrent test runs for the same slug (returns 409),
// returns 202 immediately, then runs the test command from the IMPL doc in
// a background goroutine and streams output line-by-line via the SSE broker.
func (s *Server) handleWaveTest(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	var req TestWaveRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Guard: return 409 if a test run is already in progress for this slug.
	if _, loaded := s.testingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "test run already in progress for this slug", http.StatusConflict)
		return
	}

	implPath, repoPath, resolveErr := s.resolveIMPLPath(slug)
	if resolveErr != nil {
		s.testingRuns.Delete(slug)
		http.Error(w, resolveErr.Error(), http.StatusNotFound)
		return
	}
	publish := s.makePublisher(slug)
	wave := req.Wave

	w.WriteHeader(http.StatusAccepted)

	go func() {
		defer s.testingRuns.Delete(slug)

		ctx := context.Background()

		publish("test_started", map[string]interface{}{
			"slug": slug,
			"wave": wave,
		})

		// Load the YAML manifest to get the test command.
		manifest, err := protocol.Load(implPath)
		if err != nil || manifest == nil {
			errMsg := "failed to load IMPL manifest"
			if err != nil {
				errMsg = err.Error()
			}
			publish("test_failed", map[string]interface{}{
				"slug":   slug,
				"wave":   wave,
				"status": "fail",
				"output": errMsg,
			})
			return
		}

		if manifest.TestCommand == "" {
			publish("test_failed", map[string]interface{}{
				"slug":   slug,
				"wave":   wave,
				"status": "fail",
				"output": "no test_command in IMPL doc",
			})
			return
		}

		// Run test command via sh -c to support compound commands like
		// "go test -v ./... && cd web && npx vitest run".
		// Setpgid puts the process in its own group so killing the group
		// also terminates grandchildren (vitest workers, etc.).
		cmd := exec.CommandContext(ctx, "sh", "-c", manifest.TestCommand)
		cmd.Dir = repoPath
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

		// Combine stdout and stderr into a single io.Pipe so we can stream
		// output line-by-line. (Setting cmd.Stderr = cmd.Stdout is not valid
		// when using StdoutPipe, so we use io.Pipe directly.)
		pr, pw := io.Pipe()
		cmd.Stdout = pw
		cmd.Stderr = pw

		if err := cmd.Start(); err != nil {
			_ = pw.Close()
			publish("test_failed", map[string]interface{}{
				"slug":   slug,
				"wave":   wave,
				"status": "fail",
				"output": "failed to start test command: " + err.Error(),
			})
			return
		}

		// Wait for the command in a separate goroutine and close the pipe
		// write-end so the scanner below sees EOF when the process exits.
		// After Wait returns, kill the entire process group to clean up any
		// orphaned grandchildren (e.g. vitest worker threads).
		doneCh := make(chan error, 1)
		go func() {
			waitErr := cmd.Wait()
			_ = pw.Close()
			if cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
			doneCh <- waitErr
		}()

		// Stream output line by line, accumulating for the failure payload.
		var accumulated strings.Builder
		scanner := bufio.NewScanner(pr)
		for scanner.Scan() {
			line := scanner.Text()
			accumulated.WriteString(line)
			accumulated.WriteString("\n")
			publish("test_output", map[string]interface{}{
				"slug":  slug,
				"wave":  wave,
				"chunk": line + "\n",
			})
		}

		waitErr := <-doneCh
		if waitErr != nil {
			publish("test_failed", map[string]interface{}{
				"slug":   slug,
				"wave":   wave,
				"status": "fail",
				"output": accumulated.String(),
			})
			return
		}

		publish("test_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "pass",
		})
	}()
}

// handleMergeAbort handles POST /api/wave/{slug}/merge-abort.
// Runs `git merge --abort` in the IMPL's repo to recover from a conflicted state.
func (s *Server) handleMergeAbort(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	_, repoPath, resolveErr := s.resolveIMPLPath(slug)
	if resolveErr != nil {
		http.Error(w, resolveErr.Error(), http.StatusNotFound)
		return
	}

	cmd := exec.Command("git", "merge", "--abort")
	cmd.Dir = repoPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		http.Error(w, fmt.Sprintf("git merge --abort failed: %s: %s", err, string(out)), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "merge aborted successfully")
}

// extractConflictingFiles parses an error string from a failed merge and
// returns a list of file paths that appear on lines containing "CONFLICT".
// Returns an empty slice if no conflict lines are found.
func extractConflictingFiles(errStr string) []string {
	var files []string
	for _, line := range strings.Split(errStr, "\n") {
		if !strings.Contains(line, "CONFLICT") {
			continue
		}
		// Git conflict lines typically look like:
		//   CONFLICT (content): Merge conflict in path/to/file.go
		// Extract the filename after the last space.
		parts := strings.Fields(line)
		if len(parts) > 0 {
			files = append(files, parts[len(parts)-1])
		}
	}
	return files
}

// resolveConflictsFunc is the seam used by handleResolveConflicts. Tests can
// replace this to inject a no-op and avoid real git/Claude API calls in unit tests.
var resolveConflictsFunc = func(ctx context.Context, opts engine.ResolveConflictsOpts) error {
	return engine.ResolveConflicts(ctx, opts)
}

// handleResolveConflicts handles POST /api/wave/{slug}/resolve-conflicts.
// It guards against concurrent resolution/merge for the same slug (returns 409),
// returns 202 immediately, then runs engine.ResolveConflicts in a background
// goroutine and streams progress via the SSE broker.
//
// Request body: {"wave": <int>}
//
// SSE events published:
//   - conflict_resolving: per-file progress (status="resolving")
//   - conflict_resolved: per-file progress (status="resolved")
//   - conflict_resolution_failed: on error
//   - merge_complete: on success
//
// Route registration: POST /api/wave/{slug}/resolve-conflicts
// (Must be wired in server.go by calling RegisterConflictRoutes)
func (s *Server) handleResolveConflicts(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	var req MergeWaveRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Guard: return 409 if a merge or resolution is already in progress for this slug.
	// We reuse mergingRuns because merge and resolve are mutually exclusive operations.
	if _, loaded := s.mergingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "merge or conflict resolution already in progress for this slug", http.StatusConflict)
		return
	}

	implPath, repoPath, resolveErr := s.resolveIMPLPath(slug)
	if resolveErr != nil {
		s.mergingRuns.Delete(slug)
		http.Error(w, resolveErr.Error(), http.StatusNotFound)
		return
	}
	publish := s.makePublisher(slug)
	wave := req.Wave

	w.WriteHeader(http.StatusAccepted)

	go func() {
		defer s.mergingRuns.Delete(slug)

		ctx := context.Background()

		err := resolveConflictsFunc(ctx, engine.ResolveConflictsOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			WaveNum:  wave,
			OnProgress: func(file string, status string) {
				eventName := ""
				switch status {
				case "resolving":
					eventName = "conflict_resolving"
				case "resolved":
					eventName = "conflict_resolved"
				}
				if eventName != "" {
					publish(eventName, map[string]interface{}{
						"slug": slug,
						"wave": wave,
						"file": file,
					})
				}
			},
			OnOutput: func(chunk string) {
				publish("merge_output", map[string]interface{}{
					"slug":  slug,
					"wave":  wave,
					"chunk": chunk,
				})
			},
		})

		if err != nil {
			publish("conflict_resolution_failed", map[string]interface{}{
				"slug":  slug,
				"wave":  wave,
				"error": err.Error(),
			})
			return
		}

		// Post-resolve: go.mod fixup + worktree cleanup (same as handleWaveMerge)
		if fixed, fixErr := protocol.FixGoModReplacePaths(repoPath); fixErr != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("go.mod fixup warning: %v\n", fixErr)})
		} else if fixed {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": "Auto-corrected go.mod replace paths\n"})
		}

		if cleanupResult, cleanErr := protocol.Cleanup(implPath, wave, repoPath); cleanErr != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("Cleanup warning: %v\n", cleanErr)})
		} else if cleanupResult.IsSuccess() {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("Cleaned up %d worktrees\n", len(cleanupResult.GetData().Agents))})
		}

		publish("merge_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "success",
		})
	}()
}

// RegisterConflictRoutes registers the conflict resolution and build fix endpoints.
// This should be called from server.go's New() function.
func (s *Server) RegisterConflictRoutes() {
	s.mux.HandleFunc("POST /api/wave/{slug}/resolve-conflicts", s.handleResolveConflicts)
	s.mux.HandleFunc("POST /api/wave/{slug}/fix-build", s.handleFixBuild)
}

// handleFixBuild handles POST /api/wave/{slug}/fix-build.
// Uses AI to diagnose and fix a build/test/gate failure after merge.
// Returns 202 immediately, streams progress via SSE (fix_build_output, fix_build_complete, fix_build_failed).
func (s *Server) handleFixBuild(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	var body struct {
		Wave     int    `json:"wave"`
		ErrorLog string `json:"error_log"`
		GateType string `json:"gate_type"`
	}
	if err := decodeJSON(r, &body); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if body.Wave < 1 {
		http.Error(w, "wave must be >= 1", http.StatusBadRequest)
		return
	}
	if body.ErrorLog == "" {
		http.Error(w, "error_log is required", http.StatusBadRequest)
		return
	}

	implPath, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Read chat model from config.
	chatModel := ""
	if sawCfg := config.LoadOrDefault(repoPath); sawCfg != nil {
		chatModel = sawCfg.Agent.ChatModel
	}

	publish := s.makePublisher(slug)

	w.WriteHeader(http.StatusAccepted)

	go func() {
		publish("fix_build_started", map[string]interface{}{
			"slug": slug,
			"wave": body.Wave,
			"gate": body.GateType,
		})

		err := engine.FixBuildFailure(context.Background(), engine.FixBuildOpts{
			IMPLPath:  implPath,
			RepoPath:  repoPath,
			WaveNum:   body.Wave,
			ErrorLog:  body.ErrorLog,
			GateType:  body.GateType,
			ChatModel: chatModel,
			OnOutput: func(chunk string) {
				publish("fix_build_output", map[string]interface{}{
					"slug":  slug,
					"wave":  body.Wave,
					"chunk": chunk,
				})
			},
			OnToolCall: func(ev backend.ToolCallEvent) {
				publish("fix_build_tool_call", map[string]interface{}{
					"slug":        slug,
					"wave":        body.Wave,
					"tool_id":     ev.ID,
					"tool_name":   ev.Name,
					"input":       ev.Input,
					"is_result":   ev.IsResult,
					"is_error":    ev.IsError,
					"duration_ms": ev.DurationMs,
				})
			},
		})

		if err != nil {
			publish("fix_build_failed", map[string]interface{}{
				"slug":  slug,
				"wave":  body.Wave,
				"error": err.Error(),
			})
			return
		}

		publish("fix_build_complete", map[string]interface{}{
			"slug": slug,
			"wave": body.Wave,
		})
	}()
}
