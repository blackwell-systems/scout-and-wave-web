package api

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runProgramTier executes all IMPLs in a single tier.
// Called from handleExecuteTier (Agent A) in a background goroutine.
// For each IMPL in the tier:
//   1. Find or create the IMPL doc (scout if needed)
//   2. Execute waves via runWaveLoop (reuses existing wave runner)
//   3. After all IMPLs complete, run tier gates
//   4. Freeze contracts at this tier boundary
func runProgramTier(
	programPath string,
	programSlug string,
	tierNumber int,
	repoPath string,
	publish func(event string, data interface{}),
	globalBroadcast func(),
) error {
	// Parse the PROGRAM manifest
	manifest, err := protocol.ParseProgramManifest(programPath)
	if err != nil {
		return fmt.Errorf("failed to parse PROGRAM manifest: %w", err)
	}

	// Find the tier by number
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

	// Publish tier started event
	publish("program_tier_started", map[string]interface{}{
		"program_slug": programSlug,
		"tier":         tierNumber,
	})

	// Execute each IMPL in the tier sequentially
	for _, implSlug := range tier.Impls {
		// Publish IMPL started event
		publish("program_impl_started", map[string]interface{}{
			"program_slug": programSlug,
			"impl_slug":    implSlug,
		})

		// Resolve the IMPL doc path (search docs/IMPL/ directories)
		implPath, err := resolveIMPLPathForProgram(implSlug, repoPath)
		if err != nil {
			publish("program_blocked", map[string]interface{}{
				"program_slug": programSlug,
				"impl_slug":    implSlug,
				"reason":       fmt.Sprintf("IMPL doc not found: %v", err),
			})
			return fmt.Errorf("failed to resolve IMPL %s: %w", implSlug, err)
		}

		// Create a combined publisher that wraps both IMPL-level and program-level events
		implPublish := func(event string, data interface{}) {
			// Forward IMPL-level events to program-level subscribers
			publish(event, data)
		}

		// Execute the IMPL via runWaveLoopFunc (test seam).
		// onStage is intentionally a no-op: program runner does not track per-IMPL stage state.
		runWaveLoopFunc(implPath, implSlug, repoPath, implPublish, func(ExecutionStage, StageStatus, int, string) {})

		// Check if the IMPL completed successfully by examining the manifest
		implManifest, err := protocol.Load(implPath)
		if err != nil {
			publish("program_blocked", map[string]interface{}{
				"program_slug": programSlug,
				"impl_slug":    implSlug,
				"reason":       fmt.Sprintf("failed to reload IMPL manifest: %v", err),
			})
			return fmt.Errorf("failed to reload IMPL %s manifest: %w", implSlug, err)
		}

		// Emit wave progress event (U3): count completed waves vs total.
		// A wave is complete when all its agents have entries in CompletionReports.
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

		// Verify all waves completed
		if currentWave := protocol.CurrentWave(implManifest); currentWave != nil {
			publish("program_blocked", map[string]interface{}{
				"program_slug": programSlug,
				"impl_slug":    implSlug,
				"reason":       fmt.Sprintf("IMPL execution incomplete: wave %d still pending", currentWave.Number),
			})
			return fmt.Errorf("IMPL %s execution incomplete: wave %d still pending", implSlug, currentWave.Number)
		}

		// Publish IMPL complete event
		publish("program_impl_complete", map[string]interface{}{
			"program_slug": programSlug,
			"impl_slug":    implSlug,
		})
		// Notify the pipeline view that program-driven IMPLs have updated
		if globalBroadcast != nil {
			globalBroadcast()
		}
	}

	// After all IMPLs complete, run tier gates
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

	// Freeze contracts at this tier boundary
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

	// Publish events for each frozen contract
	for _, frozen := range freezeResult.ContractsFrozen {
		publish("program_contract_frozen", map[string]interface{}{
			"program_slug":  programSlug,
			"contract_name": frozen.Name,
			"tier":          tierNumber,
		})
	}

	// Publish tier complete event
	publish("program_tier_complete", map[string]interface{}{
		"program_slug": programSlug,
		"tier":         tierNumber,
	})

	return nil
}

// resolveIMPLPathForProgram searches for an IMPL doc by slug in the repository.
// It searches complete (docs/IMPL/complete/) before active (docs/IMPL/) so that
// a completed IMPL is always preferred over any stale in-progress copy.
func resolveIMPLPathForProgram(implSlug, repoPath string) (string, error) {
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
