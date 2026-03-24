package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/resume"
)

// handleResumeExecution handles POST /api/wave/{slug}/resume.
// It finds the interrupted session for the given slug, determines which agents
// need re-launch, and runs them in a background goroutine. Returns 202 Accepted
// immediately. SSE events flow through the slug broker.
//
// Returns:
//   - 404 if no interrupted session is found for the slug
//   - 409 if multiple sessions share the same slug (cross-repo conflict) or if a
//     run is already active for this slug
//   - 202 Accepted on success
func (s *Server) handleResumeExecution(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Claim the run slot atomically; reject if already running.
	if _, loaded := s.activeRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "wave already running", http.StatusConflict)
		return
	}
	// If we fail before launching the goroutine, release the slot.
	launched := false
	defer func() {
		if !launched {
			s.activeRuns.Delete(slug)
		}
	}()

	// Gather repo paths from configuration.
	repos := s.getConfiguredRepos()
	repoPaths := make([]string, 0, len(repos))
	for _, repo := range repos {
		repoPaths = append(repoPaths, repo.Path)
	}

	// Detect interrupted sessions across all configured repos.
	allSessions, err := resume.DetectWithConfig(repoPaths)
	if err != nil {
		http.Error(w, "failed to detect sessions: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Filter to the single session matching this slug.
	var matches []resume.SessionState
	for _, ss := range allSessions {
		if ss.IMPLSlug == slug {
			matches = append(matches, ss)
		}
	}

	switch len(matches) {
	case 0:
		http.Error(w, fmt.Sprintf("no interrupted session found for slug %q", slug), http.StatusNotFound)
		return
	case 1:
		// expected — proceed below
	default:
		http.Error(w, fmt.Sprintf("multiple sessions found for slug %q (cross-repo conflict)", slug), http.StatusConflict)
		return
	}

	session := matches[0]

	// Resolve the IMPL doc path and repo for this slug.
	implPath, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Load the manifest to determine which agents need re-launch.
	manifest, err := protocol.Load(implPath)
	if err != nil {
		http.Error(w, "failed to load IMPL manifest: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Determine the current wave (the wave we are resuming).
	waveNum := session.CurrentWave
	if waveNum == 0 {
		http.Error(w, "cannot determine current wave from session state", http.StatusUnprocessableEntity)
		return
	}

	// Find the wave spec in the manifest.
	var waveAgents []protocol.Agent
	for _, w := range manifest.Waves {
		if w.Number == waveNum {
			waveAgents = w.Agents
			break
		}
	}
	if len(waveAgents) == 0 {
		http.Error(w, fmt.Sprintf("wave %d not found in manifest", waveNum), http.StatusUnprocessableEntity)
		return
	}

	// Build a map of dirty worktrees by agentID for quick lookup.
	dirtyByAgent := make(map[string]resume.DirtyWorktree)
	for _, dw := range session.DirtyWorktrees {
		dirtyByAgent[dw.AgentID] = dw
	}

	// Determine which agents need re-launching.
	// - status "complete" in completion reports → skip
	// - all others → re-launch
	type agentLaunch struct {
		letter       string
		promptPrefix string
	}
	var toLaunch []agentLaunch

	for _, ag := range waveAgents {
		report, hasReport := manifest.CompletionReports[ag.ID]
		if hasReport && report.Status == "complete" {
			// Already done — skip.
			continue
		}

		prefix := ""
		if dw, isDirty := dirtyByAgent[ag.ID]; isDirty && dw.HasChanges {
			// Agent has uncommitted work in an existing worktree.
			// Known limitation: RunSingleAgent always creates a new worktree.
			// We surface the dirty worktree info via the prompt prefix so the
			// resuming agent is aware of it, but a full existing-worktree
			// resumption is not yet supported by the engine.
			prefix = fmt.Sprintf(
				"NOTE: This is a resume. Your previous worktree at %q (branch %q) "+
					"has uncommitted changes. A new worktree has been created for this "+
					"re-launch. Please review the prior work if needed.",
				dw.Path, dw.Branch,
			)
		}

		toLaunch = append(toLaunch, agentLaunch{letter: ag.ID, promptPrefix: prefix})
	}

	// Read model config (same pattern as handleWaveAgentRerun).
	waveModel := ""
	integrationModel := ""
	if sawCfg := config.LoadOrDefault(repoPath); sawCfg != nil {
		waveModel = sawCfg.Agent.WaveModel
		integrationModel = sawCfg.Agent.IntegrationModel
	}
	if fallbackSAWConfig != nil {
		if waveModel == "" {
			waveModel = fallbackSAWConfig.Agent.WaveModel
		}
		if integrationModel == "" {
			integrationModel = fallbackSAWConfig.Agent.IntegrationModel
		}
	}

	opts := engine.RunWaveOpts{
		IMPLPath:         implPath,
		RepoPath:         repoPath,
		Slug:             slug,
		WaveModel:        waveModel,
		IntegrationModel: integrationModel,
	}

	publish := s.makePublisher(slug)
	enginePublisher := s.makeEnginePublisher(slug)

	// Return 202 before launching the goroutine.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, `{"status":"accepted","slug":%q,"wave":%d,"agents":%d}`,
		slug, waveNum, len(toLaunch))

	launched = true

	go func() {
		defer s.activeRuns.Delete(slug)
		defer s.globalBroker.broadcast("impl_list_updated")

		publish("resume_started", map[string]interface{}{
			"slug": slug,
			"wave": waveNum,
		})

		for _, al := range toLaunch {
			publish("agent_resumed", map[string]interface{}{
				"slug":   slug,
				"wave":   waveNum,
				"agent":  al.letter,
				"status": "launching",
			})

			if err := engine.RunSingleAgent(
				context.Background(),
				opts,
				waveNum,
				al.letter,
				al.promptPrefix,
				enginePublisher,
			); err != nil {
				publish("agent_failed", map[string]interface{}{
					"agent":        al.letter,
					"wave":         waveNum,
					"status":       "failed",
					"failure_type": "resume",
					"message":      err.Error(),
				})
			}
		}

		publish("resume_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   waveNum,
			"status": "success",
		})
	}()
}
