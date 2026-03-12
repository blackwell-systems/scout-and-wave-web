package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"

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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Guard: return 409 if a merge is already in progress for this slug.
	if _, loaded := s.mergingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "merge already in progress for this slug", http.StatusConflict)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
	publish := s.makePublisher(slug)
	wave := req.Wave

	w.WriteHeader(http.StatusAccepted)

	go func() {
		defer s.mergingRuns.Delete(slug)

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
			RepoPath: s.cfg.RepoPath,
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Guard: return 409 if a test run is already in progress for this slug.
	if _, loaded := s.testingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "test run already in progress for this slug", http.StatusConflict)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
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
		// "go test ./... && cd web && npm test --watchAll=false".
		cmd := exec.CommandContext(ctx, "sh", "-c", manifest.TestCommand)
		cmd.Dir = s.cfg.RepoPath

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
		doneCh := make(chan error, 1)
		go func() {
			waitErr := cmd.Wait()
			_ = pw.Close()
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
