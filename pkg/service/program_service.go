package service

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// RunTracker guards against concurrent execution of the same slug.
// Uses sync.Map for lock-free concurrent access.
type RunTracker struct {
	active sync.Map // slug -> struct{}
}

// TryAcquire attempts to mark a slug as running. Returns true if acquired,
// false if already running.
func (rt *RunTracker) TryAcquire(slug string) bool {
	_, loaded := rt.active.LoadOrStore(slug, struct{}{})
	return !loaded
}

// Release marks a slug as no longer running.
func (rt *RunTracker) Release(slug string) {
	rt.active.Delete(slug)
}

// IsRunning returns true if the slug is currently executing.
func (rt *RunTracker) IsRunning(slug string) bool {
	_, ok := rt.active.Load(slug)
	return ok
}

// ProgramRuns is the package-level RunTracker for program tier executions.
var ProgramRuns RunTracker

// RepoEntry represents a configured repository. Mirrors the api.RepoEntry type
// to avoid importing net/http-dependent packages.
type RepoEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// getConfiguredRepos reads the config file and returns repo entries.
// Falls back to a single entry using deps.RepoPath if no config or repos found.
func getConfiguredRepos(deps Deps) []RepoEntry {
	type sawConfig struct {
		Repos []RepoEntry `json:"repos,omitempty"`
	}

	configPath := deps.ConfigPath(deps.RepoPath)
	if data, err := os.ReadFile(configPath); err == nil {
		var cfg sawConfig
		if json.Unmarshal(data, &cfg) == nil && len(cfg.Repos) > 0 {
			return cfg.Repos
		}
	}

	return []RepoEntry{{
		Name: filepath.Base(deps.RepoPath),
		Path: deps.RepoPath,
	}}
}

// ListPrograms scans all configured repos for PROGRAM-*.yaml files and returns
// discovery summaries.
func ListPrograms(deps Deps) ([]protocol.ProgramDiscovery, error) {
	repos := getConfiguredRepos(deps)

	var allPrograms []protocol.ProgramDiscovery

	for _, repo := range repos {
		docsDir := filepath.Join(repo.Path, "docs")
		programs, err := protocol.ListPrograms(docsDir)
		if err != nil {
			// Non-fatal: skip this repo if ListPrograms fails
			continue
		}
		allPrograms = append(allPrograms, programs...)
	}

	if allPrograms == nil {
		allPrograms = []protocol.ProgramDiscovery{}
	}

	return allPrograms, nil
}

// GetProgramStatus returns comprehensive status for a PROGRAM manifest.
func GetProgramStatus(deps Deps, slug string) (*protocol.ProgramStatusResult, error) {
	programPath, repoPath, err := ResolveProgramPath(deps, slug)
	if err != nil {
		return nil, err
	}

	manifest, err := protocol.ParseProgramManifest(programPath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse program manifest: %w", err)
	}

	status, err := protocol.GetProgramStatus(manifest, repoPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get program status: %w", err)
	}

	return status, nil
}

// ExecuteTier guards against concurrent execution and launches tier execution
// in a goroutine. The publish function is used for event notifications.
// Returns an error if the slug is already executing or the program path cannot
// be resolved. The actual tier execution runs asynchronously.
func ExecuteTier(deps Deps, slug string, tier int, auto bool) error {
	if !ProgramRuns.TryAcquire(slug) {
		return fmt.Errorf("program tier already executing")
	}

	programPath, repoPath, err := ResolveProgramPath(deps, slug)
	if err != nil {
		ProgramRuns.Release(slug)
		return err
	}

	publish := makeProgramPublisher(deps, slug)

	go func() {
		defer ProgramRuns.Release(slug)

		if err := runProgramTier(programPath, slug, tier, repoPath, publish); err != nil {
			log.Printf("ExecuteTier(%s, tier=%d) error: %v", slug, tier, err)
			publish("program_tier_failed", map[string]interface{}{
				"program_slug": slug,
				"tier":         tier,
				"error":        err.Error(),
			})
		}
	}()

	return nil
}

// ReplanProgram launches the Planner agent to revise the PROGRAM manifest.
// Reads the planner model from the repo's saw.config.json if available.
func ReplanProgram(deps Deps, slug string, reason string, failedTier int) error {
	programPath, repoPath, err := ResolveProgramPath(deps, slug)
	if err != nil {
		return err
	}

	if reason == "" {
		reason = "user-initiated replan"
	}

	// Read planner model from config
	plannerModel := ""
	configPath := deps.ConfigPath(repoPath)
	if cfgData, err := os.ReadFile(configPath); err == nil {
		type agentCfg struct {
			PlannerModel string `json:"planner_model"`
		}
		type sawCfg struct {
			Agent agentCfg `json:"agent"`
		}
		var cfg sawCfg
		if json.Unmarshal(cfgData, &cfg) == nil {
			plannerModel = cfg.Agent.PlannerModel
		}
	}

	publish := makeProgramPublisher(deps, slug)

	go func() {
		result, err := engine.ReplanProgram(engine.ReplanProgramOpts{
			ProgramManifestPath: programPath,
			Reason:              reason,
			FailedTier:          failedTier,
			PlannerModel:        plannerModel,
		})
		if err != nil {
			log.Printf("ReplanProgram(%s) error: %v", slug, err)
			publish("program_replan_failed", map[string]string{
				"program_slug": slug,
				"error":        err.Error(),
			})
			return
		}
		publish("program_replan_complete", map[string]interface{}{
			"program_slug":      slug,
			"validation_passed": result.ValidationPassed,
			"changes_summary":   result.ChangesSummary,
		})
	}()

	return nil
}

// ResolveProgramPath searches all configured repos for PROGRAM-{slug}.yaml.
// Returns (programPath, repoPath, nil) on success, or error if not found.
func ResolveProgramPath(deps Deps, slug string) (string, string, error) {
	repos := getConfiguredRepos(deps)

	for _, repo := range repos {
		docsDir := filepath.Join(repo.Path, "docs")
		programPath := filepath.Join(docsDir, fmt.Sprintf("PROGRAM-%s.yaml", slug))

		if _, err := os.Stat(programPath); err == nil {
			return programPath, repo.Path, nil
		}
	}

	return "", "", fmt.Errorf("PROGRAM doc not found for slug: %s", slug)
}

// makeProgramPublisher creates an event publisher function for program events.
func makeProgramPublisher(deps Deps, slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		if deps.Publisher != nil {
			deps.Publisher.Publish(slug, Event{
				Channel: slug,
				Name:    event,
				Data:    data,
			})
		}
	}
}

// runProgramTier executes all IMPLs in a single tier.
// For each IMPL in the tier:
//  1. Find the IMPL doc
//  2. Execute waves (placeholder — actual wave loop wiring is out of scope)
//  3. After all IMPLs complete, run tier gates
//  4. Freeze contracts at this tier boundary
func runProgramTier(
	programPath string,
	programSlug string,
	tierNumber int,
	repoPath string,
	publish func(event string, data interface{}),
) error {
	manifest, err := protocol.ParseProgramManifest(programPath)
	if err != nil {
		return fmt.Errorf("failed to parse PROGRAM manifest: %w", err)
	}

	var tier *protocol.ProgramTier
	for i := range manifest.Tiers {
		if manifest.Tiers[i].Number == tierNumber {
			tier = &manifest.Tiers[i]
			break
		}
	}

	if tier == nil {
		return fmt.Errorf("tier %d not found in manifest", tierNumber)
	}

	publish("program_tier_started", map[string]interface{}{
		"program_slug": programSlug,
		"tier":         tierNumber,
	})

	for _, implSlug := range tier.Impls {
		publish("program_impl_started", map[string]interface{}{
			"program_slug": programSlug,
			"impl_slug":    implSlug,
		})

		implPath, err := ResolveIMPLPathForProgram(implSlug, repoPath)
		if err != nil {
			publish("program_blocked", map[string]interface{}{
				"program_slug": programSlug,
				"impl_slug":    implSlug,
				"reason":       fmt.Sprintf("IMPL doc not found: %v", err),
			})
			return fmt.Errorf("failed to resolve IMPL %s: %w", implSlug, err)
		}

		// Check completion by examining the manifest
		implManifest, err := protocol.Load(implPath)
		if err != nil {
			publish("program_blocked", map[string]interface{}{
				"program_slug": programSlug,
				"impl_slug":    implSlug,
				"reason":       fmt.Sprintf("failed to load IMPL manifest: %v", err),
			})
			return fmt.Errorf("failed to load IMPL %s manifest: %w", implSlug, err)
		}

		// Emit wave progress event
		totalWaves := len(implManifest.Waves)
		completedWaves := 0
		for _, w := range implManifest.Waves {
			allComplete := len(w.Agents) > 0
			for _, ag := range w.Agents {
				if _, hasReport := implManifest.CompletionReports[ag.ID]; !hasReport {
					allComplete = false
					break
				}
			}
			if allComplete {
				completedWaves++
			}
		}
		publish("program_impl_wave_progress", map[string]interface{}{
			"program_slug": programSlug,
			"impl_slug":    implSlug,
			"current_wave": completedWaves,
			"total_waves":  totalWaves,
		})

		if currentWave := protocol.CurrentWave(implManifest); currentWave != nil {
			publish("program_blocked", map[string]interface{}{
				"program_slug": programSlug,
				"impl_slug":    implSlug,
				"reason":       fmt.Sprintf("IMPL execution incomplete: wave %d still pending", currentWave.Number),
			})
			return fmt.Errorf("IMPL %s execution incomplete: wave %d still pending", implSlug, currentWave.Number)
		}

		publish("program_impl_complete", map[string]interface{}{
			"program_slug": programSlug,
			"impl_slug":    implSlug,
		})
	}

	// Run tier gates
	log.Printf("runProgramTier: running tier gates for tier %d", tierNumber)
	gateResult, err := protocol.RunTierGate(manifest, tierNumber, repoPath)
	if err != nil {
		publish("program_blocked", map[string]interface{}{
			"program_slug": programSlug,
			"tier":         tierNumber,
			"reason":       fmt.Sprintf("tier gate error: %v", err),
		})
		return fmt.Errorf("tier gate error: %w", err)
	}

	if !gateResult.Passed {
		publish("program_blocked", map[string]interface{}{
			"program_slug": programSlug,
			"tier":         tierNumber,
			"reason":       "tier gates failed",
			"gate_results": gateResult,
		})
		return fmt.Errorf("tier gates failed for tier %d", tierNumber)
	}

	// Freeze contracts
	log.Printf("runProgramTier: freezing contracts at tier %d", tierNumber)
	freezeResult, err := protocol.FreezeContracts(manifest, tierNumber, repoPath)
	if err != nil {
		publish("program_blocked", map[string]interface{}{
			"program_slug": programSlug,
			"tier":         tierNumber,
			"reason":       fmt.Sprintf("contract freeze error: %v", err),
		})
		return fmt.Errorf("contract freeze error: %w", err)
	}

	if !freezeResult.Success {
		publish("program_blocked", map[string]interface{}{
			"program_slug": programSlug,
			"tier":         tierNumber,
			"reason":       "contract freeze failed",
			"errors":       freezeResult.Errors,
		})
		return fmt.Errorf("contract freeze failed for tier %d: %v", tierNumber, freezeResult.Errors)
	}

	for _, frozen := range freezeResult.ContractsFrozen {
		publish("program_contract_frozen", map[string]interface{}{
			"program_slug":  programSlug,
			"contract_name": frozen.Name,
			"tier":          tierNumber,
		})
	}

	publish("program_tier_complete", map[string]interface{}{
		"program_slug": programSlug,
		"tier":         tierNumber,
	})

	return nil
}

// ResolveIMPLPathForProgram searches for an IMPL doc by slug in the repository.
// It searches complete (docs/IMPL/complete/) before active (docs/IMPL/) so that
// a completed IMPL is always preferred over any stale in-progress copy.
func ResolveIMPLPathForProgram(implSlug, repoPath string) (string, error) {
	implDirs := []string{
		filepath.Join(repoPath, "docs", "IMPL", "complete"),
		filepath.Join(repoPath, "docs", "IMPL"),
	}

	for _, implDir := range implDirs {
		yamlPath := filepath.Join(implDir, "IMPL-"+implSlug+".yaml")
		if _, err := os.Stat(yamlPath); err == nil {
			return yamlPath, nil
		}
	}

	return "", fmt.Errorf("IMPL doc not found for slug: %s", implSlug)
}
