package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// gateChannels stores per-slug gate channels used to pause wave execution
// between waves. Keys are slugs (string), values are chan bool (buffered 1).
var gateChannels sync.Map

// ActiveWaves tracks which slugs have an active wave execution goroutine.
// Used by StartWave to prevent duplicate runs. Exported for test access.
var ActiveWaves sync.Map

// FallbackSAWConfig is populated once from the server's default repo path.
// StartWave uses it when the target repo has no saw.config.json of its own.
var FallbackSAWConfig *SAWConfig

// StartWave loads the IMPL manifest for the given slug, resolves paths,
// and launches wave execution in a background goroutine. It returns
// immediately. Progress is communicated via deps.Publisher.
//
// Returns an error if the slug is already running or the IMPL doc cannot
// be found.
func StartWave(deps Deps, slug string) error {
	// Prevent duplicate runs.
	if _, loaded := ActiveWaves.LoadOrStore(slug, struct{}{}); loaded {
		return fmt.Errorf("wave already running for slug %q", slug)
	}

	// Resolve the IMPL doc path.
	implPath, repoPath, err := resolveIMPLPath(deps, slug)
	if err != nil {
		ActiveWaves.Delete(slug)
		return fmt.Errorf("IMPL doc not found for slug %q: %w", slug, err)
	}

	publish := makePublish(deps, slug)

	go func() {
		defer ActiveWaves.Delete(slug)
		runWaveLoop(implPath, slug, repoPath, publish)
	}()

	return nil
}

// StopWave cancels a running wave execution for the given slug.
// If no wave is running, it returns an error.
func StopWave(deps Deps, slug string) error {
	if _, ok := ActiveWaves.Load(slug); !ok {
		return fmt.Errorf("no wave running for slug %q", slug)
	}
	// Remove from active runs to signal stop.
	ActiveWaves.Delete(slug)
	return nil
}

// ProceedGate sends a proceed signal to the gate channel for the given slug,
// unblocking the wave loop so it continues to the next wave.
func ProceedGate(deps Deps, slug string) error {
	val, ok := gateChannels.Load(slug)
	if !ok {
		return fmt.Errorf("no gate pending for slug %q", slug)
	}

	ch, ok := val.(chan bool)
	if !ok {
		return fmt.Errorf("internal: gate channel type assertion failed for slug %q", slug)
	}

	// Non-blocking send: if the channel already has a value (e.g. double-click),
	// we just drop this one rather than blocking.
	select {
	case ch <- true:
	default:
	}

	return nil
}

// RerunAgent launches a single-agent rerun in a background goroutine.
// It resolves the IMPL doc, reads model config, builds retry context,
// and calls engine.RunSingleAgent. Events flow through deps.Publisher.
func RerunAgent(deps Deps, slug string, wave int, agent string, scopeHint string) error {
	if wave < 1 {
		return fmt.Errorf("wave must be >= 1")
	}

	implPath, repoPath, err := resolveIMPLPath(deps, slug)
	if err != nil {
		return err
	}

	waveModel, _, integrationModel := resolveModels(deps, repoPath)

	opts := engine.RunWaveOpts{
		IMPLPath:         implPath,
		RepoPath:         repoPath,
		Slug:             slug,
		WaveModel:        waveModel,
		IntegrationModel: integrationModel,
	}

	publish := makePublish(deps, slug)
	enginePublisher := func(ev engine.Event) {
		publish(ev.Event, ev.Data)
	}

	go func() {
		if err := engine.RunSingleAgent(context.Background(), opts, wave, agent, scopeHint, enginePublisher); err != nil {
			publish("agent_failed", map[string]interface{}{
				"agent":        agent,
				"wave":         wave,
				"status":       "failed",
				"failure_type": "rerun",
				"message":      err.Error(),
			})
		}
	}()

	return nil
}

// FinalizeWave retries the finalization pipeline (verify commits, gates,
// merge, build, cleanup) for a wave whose agents completed but finalization
// previously failed. Events flow through deps.Publisher.
func FinalizeWave(deps Deps, slug string, wave int) error {
	if wave < 1 {
		return fmt.Errorf("wave must be >= 1")
	}

	implPath, repoPath, err := resolveIMPLPath(deps, slug)
	if err != nil {
		return err
	}

	publish := makePublish(deps, slug)

	go func() {
		publish("merge_started", map[string]interface{}{
			"slug": slug,
			"wave": wave,
		})
		publish("merge_output", map[string]interface{}{
			"slug":  slug,
			"wave":  wave,
			"chunk": fmt.Sprintf("Retrying finalization for wave %d...\n", wave),
		})

		finalizeResult, err := engine.FinalizeWave(context.Background(), engine.FinalizeWaveOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			WaveNum:  wave,
		})
		if finalizeResult != nil {
			for _, gate := range finalizeResult.GateResults {
				publish("quality_gate_result", gate)
			}
		}
		if err != nil {
			publish("merge_failed", map[string]interface{}{
				"slug":  slug,
				"wave":  wave,
				"error": err.Error(),
			})
			return
		}

		publish("merge_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "success",
		})
	}()

	return nil
}

// runWaveLoop is the background goroutine body. It uses the engine package to
// parse the IMPL doc, then executes waves one at a time. Between waves it
// publishes a "wave_gate_pending" event and blocks for up to 30 minutes
// waiting for a proceed signal via gateChannels.
//
// On any error the function publishes "run_failed" and returns.
// On success it publishes "run_complete".
func runWaveLoop(
	implPath, slug, repoPath string,
	publish func(event string, data interface{}),
) {
	publish("run_started", map[string]string{"slug": slug, "impl_path": implPath})

	// Advisory stale-branch detection -- does NOT block wave execution.
	if staleBranches := detectStaleBranches(repoPath); len(staleBranches) > 0 {
		publish("stale_branches_detected", map[string]interface{}{
			"slug":     slug,
			"branches": staleBranches,
			"count":    len(staleBranches),
		})
	}

	// Read saw.config.json to pick up configured models.
	waveModel, scaffoldModel, integrationModel := resolveModelsFromPath(repoPath)

	// Load the YAML manifest to get wave structure.
	manifest, err := protocol.Load(implPath)
	if err != nil {
		publish("run_failed", map[string]string{"error": err.Error()})
		return
	}
	if manifest == nil {
		publish("run_failed", map[string]string{"error": "failed to load IMPL manifest: " + implPath})
		return
	}

	// Cross-repo detection: check if the IMPL targets a different repo.
	if targetRepos := targetRepoNames(manifest); len(targetRepos) > 0 {
		publish("run_started", map[string]interface{}{
			"slug":         slug,
			"impl_path":    implPath,
			"target_repos": targetRepos,
			"target_repo":  targetRepos[0],
		})
	}

	resolvedPath, targetRepo, redirected := resolveTargetRepoFromManifest(manifest, repoPath)
	if targetRepo != "" && resolvedPath == "" {
		// Target repo specified but cannot be resolved -- abort.
		publish("run_failed", map[string]string{
			"error": fmt.Sprintf(
				"IMPL targets repo %q but it cannot be resolved. "+
					"Not found as sibling of %s or in saw.config.json repos list. "+
					"Configure the repo path in saw.config.json or ensure it exists as a sibling directory.",
				targetRepo, repoPath),
		})
		return
	}
	if redirected {
		fmt.Fprintf(os.Stderr, "[wave] repo redirect: %s -> %s (target repo: %s)\n", repoPath, resolvedPath, targetRepo)
		publish("repo_redirected", map[string]interface{}{
			"from":        repoPath,
			"to":          resolvedPath,
			"target_repo": targetRepo,
		})
		publish("repo_mismatch_warning", map[string]interface{}{
			"slug":             slug,
			"server_repo":      repoPath,
			"target_repo":      targetRepo,
			"target_repo_path": resolvedPath,
			"message": fmt.Sprintf(
				"IMPL targets repo %q at %s but server is running from %s. Redirecting worktree operations.",
				targetRepo, resolvedPath, repoPath),
		})
		// Override repoPath for the remainder of this wave loop.
		repoPath = resolvedPath
		// Re-resolve models from the target repo's saw.config.json.
		waveModel, scaffoldModel, integrationModel = resolveModelsFromPath(repoPath)
	}

	ctx := context.Background()

	// Run scaffold agent only when scaffolds exist and are not yet committed.
	if !protocol.AllScaffoldsCommitted(manifest) {
		publish("stage_scaffold_running", nil)
		if err := engine.RunScaffold(ctx, implPath, repoPath, "", scaffoldModel, func(ev engine.Event) {
			publish(ev.Event, ev.Data)
		}); err != nil {
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}
	}

	waves := manifest.Waves
	totalAgents := 0
	for _, w := range waves {
		totalAgents += len(w.Agents)
	}

	// Determine first incomplete wave using completion reports.
	currentWave := protocol.CurrentWave(manifest)
	startIdx := 0
	if currentWave == nil {
		// All waves complete -- mark IMPL done if not already marked (E15 + E18).
		if err := engine.MarkIMPLComplete(ctx, engine.MarkIMPLCompleteOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			Date:     time.Now().Format("2006-01-02"),
		}); err != nil {
			publish("mark_complete_warning", map[string]string{"error": err.Error()})
		}
		publish("run_complete", map[string]interface{}{
			"status": "success",
			"waves":  len(waves),
			"agents": totalAgents,
			"note":   "all waves already complete",
		})
		return
	}
	for idx, w := range waves {
		if w.Number == currentWave.Number {
			startIdx = idx
			break
		}
	}
	if startIdx > 0 {
		publish("waves_skipped", map[string]interface{}{
			"skipped": startIdx,
			"reason":  "already completed (completion reports present)",
		})
	}

	// Execute waves one at a time, pausing at gates between them.
	for i := startIdx; i < len(waves); i++ {
		wave := waves[i]
		waveNum := wave.Number

		opts := engine.RunWaveOpts{
			IMPLPath:         implPath,
			RepoPath:         repoPath,
			Slug:             slug,
			WaveModel:        waveModel,
			ScaffoldModel:    scaffoldModel,
			IntegrationModel: integrationModel,
		}

		enginePublisher := func(ev engine.Event) {
			publish(ev.Event, ev.Data)
		}

		// If all agents in this wave already have commits on their branches,
		// skip re-launching them and go straight to finalization.
		if waveAgentsHaveCommitsWithManifest(repoPath, implPath, slug, waveNum, wave.Agents) {
			publish("wave_resumed", map[string]interface{}{
				"wave":   waveNum,
				"reason": "agent branches already have commits from previous session; skipping to merge",
			})
		} else {
			if err := engine.RunSingleWave(ctx, opts, waveNum, enginePublisher); err != nil {
				publish("run_failed", map[string]string{"error": err.Error()})
				return
			}
		}

		// Finalize wave: monolithic engine.FinalizeWave.
		finalizeResult, err := engine.FinalizeWave(ctx, engine.FinalizeWaveOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			WaveNum:  waveNum,
		})
		if err != nil {
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}
		if finalizeResult != nil {
			if finalizeResult.StubReport != nil && len(finalizeResult.StubReport.Hits) > 0 {
				publish("stub_report", finalizeResult.StubReport)
			}
			for _, gate := range finalizeResult.GateResults {
				publish("quality_gate_result", gate)
			}
		}

		completedLetters := make([]string, 0, len(wave.Agents))
		for _, ag := range wave.Agents {
			completedLetters = append(completedLetters, ag.ID)
		}
		if err := engine.UpdateIMPLStatus(implPath, completedLetters); err != nil {
			publish("update_status_failed", map[string]string{
				"wave":  slug,
				"error": err.Error(),
			})
		}

		// If there is a next wave, pause at the gate and wait for approval.
		if i < len(waves)-1 {
			nextWaveNum := waves[i+1].Number

			gateCh := make(chan bool, 1)
			gateChannels.Store(slug, gateCh)

			publish("wave_gate_pending", map[string]interface{}{
				"wave":      waveNum,
				"next_wave": nextWaveNum,
				"slug":      slug,
			})

			const gateTimeout = 30 * time.Minute
			select {
			case ok := <-gateCh:
				gateChannels.Delete(slug)
				if !ok {
					publish("run_failed", map[string]string{
						"error": "gate cancelled or timed out",
					})
					return
				}
				publish("wave_gate_resolved", map[string]interface{}{
					"wave":   waveNum,
					"action": "proceed",
					"slug":   slug,
				})
			case <-time.After(gateTimeout):
				gateChannels.Delete(slug)
				publish("run_failed", map[string]string{
					"error": "gate cancelled or timed out",
				})
				return
			}
		}
	}

	// After all waves complete -- mark IMPL done (E15 + E18)
	if err := engine.MarkIMPLComplete(ctx, engine.MarkIMPLCompleteOpts{
		IMPLPath: implPath,
		RepoPath: repoPath,
		Date:     time.Now().Format("2006-01-02"),
	}); err != nil {
		publish("mark_complete_warning", map[string]string{"error": err.Error()})
	}

	publish("run_complete", map[string]interface{}{
		"status": "success",
		"waves":  len(waves),
		"agents": totalAgents,
	})
}

// makePublish creates a publish function that routes events through the
// EventPublisher on the slug's channel.
func makePublish(deps Deps, slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		deps.Publisher.Publish(slug, Event{
			Channel: slug,
			Name:    event,
			Data:    data,
		})
	}
}

// resolveIMPLPath searches all configured repositories for the IMPL doc
// with the given slug. Returns (implPath, repoPath, nil) on success.
func resolveIMPLPath(deps Deps, slug string) (string, string, error) {
	// Read saw.config.json to get the list of repos
	configPath := deps.ConfigPath(deps.RepoPath)
	configData, err := os.ReadFile(configPath)

	type repoEntry struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	type cfgShape struct {
		Repos []repoEntry `json:"repos,omitempty"`
	}

	var repos []repoEntry
	if err == nil {
		var cfg cfgShape
		if json.Unmarshal(configData, &cfg) == nil && len(cfg.Repos) > 0 {
			repos = cfg.Repos
		}
	}

	// Fallback: if no config or no repos, use the startup RepoPath
	if len(repos) == 0 {
		repos = []repoEntry{{
			Name: filepath.Base(deps.RepoPath),
			Path: deps.RepoPath,
		}}
	}

	// Search all repos for the IMPL doc (both active and complete directories)
	for _, repo := range repos {
		implDirs := []string{
			filepath.Join(repo.Path, "docs", "IMPL"),
			filepath.Join(repo.Path, "docs", "IMPL", "complete"),
		}
		for _, implDir := range implDirs {
			yamlPath := filepath.Join(implDir, "IMPL-"+slug+".yaml")
			if _, err := os.Stat(yamlPath); err == nil {
				return yamlPath, repo.Path, nil
			}
		}
	}

	return "", "", fmt.Errorf("IMPL doc not found for slug: %s", slug)
}

// resolveModels reads model configuration from saw.config.json in the
// given repo, falling back to FallbackSAWConfig for missing values.
func resolveModels(deps Deps, repoPath string) (waveModel, scaffoldModel, integrationModel string) {
	configPath := deps.ConfigPath(repoPath)
	if cfgData, err := os.ReadFile(configPath); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			waveModel = sawCfg.Agent.WaveModel
			scaffoldModel = sawCfg.Agent.ScaffoldModel
			integrationModel = sawCfg.Agent.IntegrationModel
		}
	}
	if FallbackSAWConfig != nil {
		if waveModel == "" {
			waveModel = FallbackSAWConfig.Agent.WaveModel
		}
		if scaffoldModel == "" {
			scaffoldModel = FallbackSAWConfig.Agent.ScaffoldModel
		}
		if integrationModel == "" {
			integrationModel = FallbackSAWConfig.Agent.IntegrationModel
		}
	}
	return
}

// resolveModelsFromPath reads model configuration directly from a repo path,
// without needing Deps (used by runWaveLoop which doesn't receive Deps).
func resolveModelsFromPath(repoPath string) (waveModel, scaffoldModel, integrationModel string) {
	if cfgData, err := os.ReadFile(filepath.Join(repoPath, "saw.config.json")); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			waveModel = sawCfg.Agent.WaveModel
			scaffoldModel = sawCfg.Agent.ScaffoldModel
			integrationModel = sawCfg.Agent.IntegrationModel
		}
	}
	if FallbackSAWConfig != nil {
		if waveModel == "" {
			waveModel = FallbackSAWConfig.Agent.WaveModel
		}
		if scaffoldModel == "" {
			scaffoldModel = FallbackSAWConfig.Agent.ScaffoldModel
		}
		if integrationModel == "" {
			integrationModel = FallbackSAWConfig.Agent.IntegrationModel
		}
	}
	return
}

// detectStaleBranches finds SAW agent branches that are older than 7 days.
func detectStaleBranches(repoPath string) []string {
	out, err := exec.Command("git", "-C", repoPath, "for-each-ref",
		"--format=%(refname:short) %(committerdate:unix)",
		"refs/heads/saw/").Output()
	if err != nil {
		return nil
	}

	cutoff := time.Now().Add(-7 * 24 * time.Hour).Unix()
	var stale []string
	for _, line := range splitLines(string(out)) {
		if line == "" {
			continue
		}
		var branch string
		var ts int64
		if _, err := fmt.Sscanf(line, "%s %d", &branch, &ts); err == nil {
			if ts < cutoff {
				stale = append(stale, branch)
			}
		}
	}
	return stale
}

// splitLines splits a string by newlines, returning non-empty lines.
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			if i > start {
				lines = append(lines, s[start:i])
			}
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// resolveTargetRepoFromManifest inspects the manifest's FileOwnership entries
// to determine if the IMPL targets a repo different from repoPath. If all
// repo: fields point to a single repo name that differs from repoPath's
// basename, it attempts to resolve the actual path from saw.config.json repos
// or sibling directories. Returns the resolved path (which may be the original
// repoPath if no redirect is needed) and the target repo name (empty if no
// redirect).
func resolveTargetRepoFromManifest(manifest *protocol.IMPLManifest, repoPath string) (resolvedPath, targetRepoName string, redirected bool) {
	if manifest == nil || len(manifest.FileOwnership) == 0 {
		return repoPath, "", false
	}

	// Collect distinct repo names from file_ownership entries.
	repoNames := make(map[string]bool)
	for _, fo := range manifest.FileOwnership {
		if fo.Repo != "" {
			repoNames[fo.Repo] = true
		}
	}

	// No repo: fields at all -- no redirect needed.
	if len(repoNames) == 0 {
		return repoPath, "", false
	}

	// Multiple different repos -- multi-repo wave, no single redirect.
	if len(repoNames) > 1 {
		return repoPath, "", false
	}

	// Single target repo -- check if it differs from current repoPath.
	var targetRepo string
	for name := range repoNames {
		targetRepo = name
	}

	currentRepoName := filepath.Base(repoPath)
	if targetRepo == currentRepoName {
		return repoPath, "", false
	}

	// Target repo differs -- attempt resolution.
	// 1. Try saw.config.json repos list.
	if cfgPath := filepath.Join(repoPath, "saw.config.json"); cfgPath != "" {
		if cfgData, err := os.ReadFile(cfgPath); err == nil {
			var cfg struct {
				Repos []struct {
					Name string `json:"name"`
					Path string `json:"path"`
				} `json:"repos,omitempty"`
			}
			if json.Unmarshal(cfgData, &cfg) == nil {
				for _, r := range cfg.Repos {
					if r.Name == targetRepo && r.Path != "" {
						if info, err := os.Stat(r.Path); err == nil && info.IsDir() {
							return r.Path, targetRepo, true
						}
					}
				}
			}
		}
	}

	// 2. Try sibling directory.
	siblingPath := filepath.Join(filepath.Dir(repoPath), targetRepo)
	if info, err := os.Stat(siblingPath); err == nil && info.IsDir() {
		return siblingPath, targetRepo, true
	}

	// Cannot resolve -- return empty to signal failure.
	return "", targetRepo, false
}

// targetRepoNames returns the list of distinct repo names from file_ownership.
func targetRepoNames(manifest *protocol.IMPLManifest) []string {
	if manifest == nil {
		return nil
	}
	seen := make(map[string]bool)
	var names []string
	for _, fo := range manifest.FileOwnership {
		if fo.Repo != "" && !seen[fo.Repo] {
			seen[fo.Repo] = true
			names = append(names, fo.Repo)
		}
	}
	return names
}

// waveAgentsHaveCommitsWithManifest checks whether every agent in the wave
// already has a branch with at least one commit ahead of HEAD.
func waveAgentsHaveCommitsWithManifest(repoPath, implPath, slug string, waveNum int, agents []protocol.Agent) bool {
	if len(agents) == 0 {
		return false
	}

	// Build per-agent repo map from file ownership (cross-repo support).
	agentRepoDir := make(map[string]string)
	if implPath != "" {
		if manifest, err := protocol.Load(implPath); err == nil {
			repoParent := filepath.Dir(repoPath)
			for _, agent := range agents {
				for _, fo := range manifest.FileOwnership {
					if fo.Agent == agent.ID && fo.Repo != "" && fo.Repo != filepath.Base(repoPath) {
						agentRepoDir[agent.ID] = filepath.Join(repoParent, fo.Repo)
						break
					}
				}
			}
		}
	}

	for _, agent := range agents {
		checkRepo := repoPath
		if r, ok := agentRepoDir[agent.ID]; ok {
			checkRepo = r
		}

		branch := protocol.BranchName(slug, waveNum, agent.ID)
		legacyBranch := protocol.LegacyBranchName(waveNum, agent.ID)

		activeBranch := ""
		refCheck := exec.Command("git", "-C", checkRepo, "rev-parse", "--verify", branch)
		if refCheck.Run() == nil {
			activeBranch = branch
		} else {
			refCheck2 := exec.Command("git", "-C", checkRepo, "rev-parse", "--verify", legacyBranch)
			if refCheck2.Run() == nil {
				activeBranch = legacyBranch
			} else {
				return false
			}
		}

		countOut, err := exec.Command("git", "-C", checkRepo, "rev-list", "--count", "HEAD.."+activeBranch).Output()
		if err != nil {
			return false
		}
		count := 0
		fmt.Sscanf(string(countOut), "%d", &count)
		if count == 0 {
			return false
		}
	}
	return true
}
