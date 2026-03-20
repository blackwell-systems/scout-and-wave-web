package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// RunTracker manages concurrent operation guards using a sync.Map.
// It ensures that only one operation per key can run at a time.
type RunTracker struct {
	runs sync.Map
}

// TryStart attempts to start an operation for the given key.
// Returns true if the operation was started (no other operation was running),
// false if an operation is already in progress.
func (t *RunTracker) TryStart(key string) bool {
	_, loaded := t.runs.LoadOrStore(key, struct{}{})
	return !loaded
}

// Done marks the operation for the given key as complete.
func (t *RunTracker) Done(key string) {
	t.runs.Delete(key)
}

// IsRunning returns true if an operation is in progress for the given key.
func (t *RunTracker) IsRunning(key string) bool {
	_, ok := t.runs.Load(key)
	return ok
}

// MergeFunc is the function signature for merging a wave. It is a package-level
// variable to allow test injection (seam pattern).
var MergeFunc = func(ctx context.Context, opts engine.RunMergeOpts) error {
	return engine.MergeWave(ctx, opts)
}

// ResolveConflictsFunc is the function signature for resolving merge conflicts.
// It is a package-level variable to allow test injection.
var ResolveConflictsFunc = func(ctx context.Context, opts engine.ResolveConflictsOpts) error {
	return engine.ResolveConflicts(ctx, opts)
}

// MergeTracker holds the run trackers for merge and test operations.
var MergeTracker = &RunTracker{}

// TestTracker holds the run tracker for test operations.
var TestTracker = &RunTracker{}

// MergeWave guards against concurrent merges for the same slug, then launches
// engine.MergeWave in a background goroutine and publishes merge events.
// The implPath and repoPath must be resolved by the caller.
func MergeWave(deps Deps, slug string, wave int, implPath string, repoPath string) error {
	if !MergeTracker.TryStart(slug) {
		return fmt.Errorf("merge already in progress for slug %q", slug)
	}

	publish := makeServicePublisher(deps, slug)

	go func() {
		defer MergeTracker.Done(slug)
		defer broadcastGlobal(deps, "impl_list_updated")

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

		err := MergeFunc(ctx, engine.RunMergeOpts{
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
		} else if cleanupResult != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("Cleaned up %d worktrees\n", len(cleanupResult.Agents))})
		}

		publish("merge_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "success",
		})
	}()

	broadcastGlobal(deps, "impl_list_updated") // execution started
	return nil
}

// RunTests loads the IMPL manifest, extracts the test command, and runs it
// in a background goroutine, streaming output line-by-line via events.
// The implPath and repoPath must be resolved by the caller.
func RunTests(deps Deps, slug string, wave int, implPath string, repoPath string) error {
	if !TestTracker.TryStart(slug) {
		return fmt.Errorf("test run already in progress for slug %q", slug)
	}

	publish := makeServicePublisher(deps, slug)

	go func() {
		defer TestTracker.Done(slug)

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

		runTestCommand(ctx, publish, slug, wave, manifest.TestCommand, repoPath)
	}()

	return nil
}

// FixBuild uses AI to diagnose and fix a build/test/gate failure after merge.
// The implPath and repoPath must be resolved by the caller.
func FixBuild(deps Deps, slug string, wave int, errorLog string, gateType string, implPath string, repoPath string) error {
	if errorLog == "" {
		return fmt.Errorf("error_log is required")
	}
	if wave < 1 {
		return fmt.Errorf("wave must be >= 1")
	}

	// Read chat model from saw.config.json
	chatModel := ""
	if deps.ConfigPath != nil {
		cfgPath := deps.ConfigPath(repoPath)
		if cfgData, readErr := os.ReadFile(cfgPath); readErr == nil {
			var sawCfg struct {
				Agent struct {
					ChatModel string `json:"chat_model"`
				} `json:"agent"`
			}
			if json.Unmarshal(cfgData, &sawCfg) == nil {
				chatModel = sawCfg.Agent.ChatModel
			}
		}
	}

	publish := makeServicePublisher(deps, slug)

	go func() {
		publish("fix_build_started", map[string]interface{}{
			"slug": slug,
			"wave": wave,
			"gate": gateType,
		})

		err := engine.FixBuildFailure(context.Background(), engine.FixBuildOpts{
			IMPLPath:  implPath,
			RepoPath:  repoPath,
			WaveNum:   wave,
			ErrorLog:  errorLog,
			GateType:  gateType,
			ChatModel: chatModel,
			OnOutput: func(chunk string) {
				publish("fix_build_output", map[string]interface{}{
					"slug":  slug,
					"wave":  wave,
					"chunk": chunk,
				})
			},
			OnToolCall: func(ev backend.ToolCallEvent) {
				publish("fix_build_tool_call", map[string]interface{}{
					"slug":        slug,
					"wave":        wave,
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
				"wave":  wave,
				"error": err.Error(),
			})
			return
		}

		publish("fix_build_complete", map[string]interface{}{
			"slug": slug,
			"wave": wave,
		})
	}()

	return nil
}

// AbortMerge runs `git merge --abort` in the given repo to recover from a
// conflicted state. The repoPath must be resolved by the caller.
func AbortMerge(deps Deps, slug string, repoPath string) error {
	cmd := exec.Command("git", "merge", "--abort")
	cmd.Dir = repoPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git merge --abort failed: %s: %s", err, string(out))
	}
	return nil
}

// ResolveConflicts guards against concurrent resolution/merge for the same slug,
// then launches engine.ResolveConflicts in a background goroutine.
// The implPath and repoPath must be resolved by the caller.
func ResolveConflicts(deps Deps, slug string, wave int, implPath string, repoPath string) error {
	if !MergeTracker.TryStart(slug) {
		return fmt.Errorf("merge or conflict resolution already in progress for slug %q", slug)
	}

	publish := makeServicePublisher(deps, slug)

	go func() {
		defer MergeTracker.Done(slug)

		ctx := context.Background()

		err := ResolveConflictsFunc(ctx, engine.ResolveConflictsOpts{
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

		// Post-resolve: go.mod fixup + worktree cleanup
		if fixed, fixErr := protocol.FixGoModReplacePaths(repoPath); fixErr != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("go.mod fixup warning: %v\n", fixErr)})
		} else if fixed {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": "Auto-corrected go.mod replace paths\n"})
		}

		if cleanupResult, cleanErr := protocol.Cleanup(implPath, wave, repoPath); cleanErr != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("Cleanup warning: %v\n", cleanErr)})
		} else if cleanupResult != nil {
			publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("Cleaned up %d worktrees\n", len(cleanupResult.Agents))})
		}

		publish("merge_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "success",
		})
	}()

	return nil
}

// makeServicePublisher creates a publish function that sends events on the
// slug-specific channel using the EventPublisher from Deps.
func makeServicePublisher(deps Deps, slug string) func(string, interface{}) {
	return func(event string, data interface{}) {
		deps.Publisher.Publish("impl:"+slug, Event{
			Channel: "impl:" + slug,
			Name:    event,
			Data:    data,
		})
	}
}

// broadcastGlobal sends a global event (not slug-specific).
func broadcastGlobal(deps Deps, event string) {
	deps.Publisher.Publish("global", Event{
		Channel: "global",
		Name:    event,
		Data:    nil,
	})
}

// extractConflictingFiles parses an error string from a failed merge and
// returns a list of file paths that appear on lines containing "CONFLICT".
func extractConflictingFiles(errStr string) []string {
	var files []string
	for _, line := range strings.Split(errStr, "\n") {
		if !strings.Contains(line, "CONFLICT") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) > 0 {
			files = append(files, parts[len(parts)-1])
		}
	}
	return files
}

// runTestCommand runs the given test command in the repo directory and streams
// output via events.
func runTestCommand(ctx context.Context, publish func(string, interface{}), slug string, wave int, testCommand string, repoPath string) {
	cmd := exec.CommandContext(ctx, "sh", "-c", testCommand)
	cmd.Dir = repoPath

	out, err := cmd.CombinedOutput()
	output := string(out)

	// Stream the output as a single chunk
	if output != "" {
		publish("test_output", map[string]interface{}{
			"slug":  slug,
			"wave":  wave,
			"chunk": output,
		})
	}

	if err != nil {
		publish("test_failed", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "fail",
			"output": output,
		})
		return
	}

	publish("test_complete", map[string]interface{}{
		"slug":   slug,
		"wave":   wave,
		"status": "pass",
	})
}
