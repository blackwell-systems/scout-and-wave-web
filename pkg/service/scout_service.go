package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// scoutRuns tracks running scout contexts for cancellation.
var scoutRuns sync.Map // runID -> context.CancelFunc

// Slugify converts a feature description to a URL-safe slug.
// Lowercases, replaces non-alphanumeric runs with hyphens, trims, and
// truncates to 40 characters.
func Slugify(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

// StartScout launches a scout agent in a background goroutine.
// It returns a unique runID immediately. Progress is communicated via
// deps.Publisher on the "scout-{runID}" channel.
func StartScout(deps Deps, feature string, repo string) (string, error) {
	if feature == "" {
		return "", fmt.Errorf("feature is required")
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	scoutRuns.Store(runID, cancel)

	go func() {
		defer scoutRuns.Delete(runID)
		defer cancel()
		runScoutAgent(ctx, deps, runID, feature, repo)
	}()

	return runID, nil
}

// CancelScout cancels a running scout by its runID.
// Returns nil even if the runID is not found (idempotent).
func CancelScout(_ Deps, runID string) error {
	if v, ok := scoutRuns.Load(runID); ok {
		if cancel, ok := v.(context.CancelFunc); ok {
			cancel()
		}
	}
	return nil
}

// sawConfig mirrors the saw.config.json structure needed for scout model lookup.
type sawConfig struct {
	Agent struct {
		ScoutModel string `json:"scout_model"`
	} `json:"agent"`
}

// runScoutAgent executes the Scout engine in the current goroutine.
// It publishes scout_output, scout_complete, scout_failed, scout_finalize,
// and scout_cancelled events via deps.Publisher.
func runScoutAgent(ctx context.Context, deps Deps, runID, feature, repoOverride string) {
	brokerKey := "scout-" + runID

	publish := func(eventName string, data interface{}) {
		deps.Publisher.Publish(brokerKey, Event{
			Channel: brokerKey,
			Name:    eventName,
			Data:    data,
		})
	}

	// Resolve repo root.
	repoRoot := repoOverride
	if repoRoot == "" {
		repoRoot = deps.RepoPath
	}

	// Compute slug and IMPL output path.
	slug := Slugify(feature)
	implOut := filepath.Join(repoRoot, "docs", "IMPL", "IMPL-"+slug+".yaml")

	// Locate SAW repo for prompt files.
	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			publish("scout_failed", map[string]string{
				"run_id": runID,
				"error":  "cannot determine home directory: " + err.Error(),
			})
			return
		}
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}

	// Read saw.config.json to pick up the configured scout model.
	scoutModel := ""
	cfgPath := filepath.Join(repoRoot, "saw.config.json")
	if deps.ConfigPath != nil {
		cfgPath = deps.ConfigPath(repoRoot)
	}
	if cfgData, err := os.ReadFile(cfgPath); err == nil {
		var cfg sawConfig
		if json.Unmarshal(cfgData, &cfg) == nil {
			scoutModel = cfg.Agent.ScoutModel
		}
	}

	onChunk := func(chunk string) {
		publish("scout_output", map[string]string{
			"run_id": runID,
			"chunk":  chunk,
		})
	}

	execErr := engine.RunScout(ctx, engine.RunScoutOpts{
		Feature:             feature,
		RepoPath:            repoRoot,
		SAWRepoPath:         sawRepo,
		IMPLOutPath:         implOut,
		ScoutModel:          scoutModel,
		UseStructuredOutput: true,
	}, onChunk)

	if execErr != nil {
		if ctx.Err() != nil {
			publish("scout_cancelled", map[string]string{"run_id": runID})
		} else {
			publish("scout_failed", map[string]string{
				"run_id": runID,
				"error":  execErr.Error(),
			})
		}
		return
	}

	// Finalize IMPL doc (M4: populate verification gates).
	publish("scout_finalize", map[string]string{
		"run_id": runID,
		"status": "running",
	})

	finalizeResult, finalizeErr := engine.FinalizeIMPLEngine(ctx, implOut, repoRoot)
	if finalizeErr != nil {
		publish("scout_failed", map[string]string{
			"run_id": runID,
			"error":  "finalize-impl failed: " + finalizeErr.Error(),
		})
		return
	}

	// Finalize warnings are non-fatal — IMPL doc still usable.
	if !finalizeResult.Success {
		publish("scout_finalize", map[string]string{
			"run_id":  runID,
			"status":  "warning",
			"message": "Verification gates not fully populated (H2 data unavailable or validation issues)",
		})
	} else {
		publish("scout_finalize", map[string]string{
			"run_id":         runID,
			"status":         "complete",
			"agents_updated": fmt.Sprintf("%d", finalizeResult.GatePopulation.AgentsUpdated),
		})
	}

	publish("scout_complete", map[string]string{
		"run_id":    runID,
		"slug":      slug,
		"impl_path": implOut,
	})
}
