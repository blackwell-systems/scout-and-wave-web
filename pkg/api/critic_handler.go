package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// CriticFix represents a single auto-fix operation for a critic issue.
// Used as the request body for PATCH /api/impl/{slug}/fix-critic.
type CriticFix struct {
	Type         string `json:"type"`                       // "add_file_ownership", "update_contract", "add_integration_connector"
	AgentID      string `json:"agent_id"`
	Wave         int    `json:"wave"`
	File         string `json:"file,omitempty"`
	Action       string `json:"action,omitempty"`           // "modify", "new", "delete"
	ContractName string `json:"contract_name,omitempty"`
	OldSymbol    string `json:"old_symbol,omitempty"`
	NewSymbol    string `json:"new_symbol,omitempty"`
}

// handleGetCriticReview serves GET /api/impl/{slug}/critic-review.
// Loads the IMPL manifest for the given slug and returns the critic_report
// field as JSON. Returns 404 if the IMPL doc is not found or no critic
// review has been written yet. Returns 500 on parse errors.
func (s *Server) handleGetCriticReview(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	implPath, _ := s.findImplPath(slug)
	if implPath == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "IMPL doc not found"})
		return
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to load IMPL manifest"})
		return
	}

	result := protocol.GetCriticReview(manifest)
	if result == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "no critic review for this IMPL"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleRunCriticReview serves POST /api/impl/{slug}/run-critic.
// Starts the critic gate asynchronously and returns 202 immediately.
// The critic_review_complete SSE event fires when the review is written.
func (s *Server) handleRunCriticReview(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	implPath, _ := s.findImplPath(slug)
	if implPath == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "IMPL doc not found"})
		return
	}
	go s.runCriticAsync(slug, implPath)
	w.WriteHeader(http.StatusAccepted)
}

// criticTimeout is the maximum duration for a critic subprocess to complete.
var criticTimeout = 5 * time.Minute

// criticCommandFunc creates the exec.Cmd for critic execution.
// Overridable in tests.
var criticCommandFunc = func(ctx context.Context, implPath string) *exec.Cmd {
	return exec.CommandContext(ctx, "sawtools", "run-critic", implPath) //nolint:gosec
}

// runCriticAsync invokes sawtools run-critic, streaming stdout/stderr as
// critic_output SSE events, and emits critic_review_complete on success or
// critic_review_failed on error. Safe to call in a goroutine.
func (s *Server) runCriticAsync(slug, implPath string) {
	s.globalBroker.broadcastJSON("critic_review_started", map[string]string{"slug": slug})

	ctx, cancel := context.WithTimeout(context.Background(), criticTimeout)
	defer cancel()

	cmd := criticCommandFunc(ctx, implPath)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.globalBroker.broadcastJSON("critic_review_failed", map[string]interface{}{
			"slug": slug, "error": "stdout pipe: " + err.Error(),
		})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.globalBroker.broadcastJSON("critic_review_failed", map[string]interface{}{
			"slug": slug, "error": "stderr pipe: " + err.Error(),
		})
		return
	}

	if err := cmd.Start(); err != nil {
		s.globalBroker.broadcastJSON("critic_review_failed", map[string]interface{}{
			"slug": slug, "error": err.Error(),
		})
		return
	}

	// Stream stdout line-by-line
	scanDone := make(chan struct{})
	go func() {
		defer close(scanDone)
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			s.globalBroker.broadcastJSON("critic_output", map[string]interface{}{
				"slug": slug, "chunk": scanner.Text() + "\n",
			})
		}
	}()

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		s.globalBroker.broadcastJSON("critic_output", map[string]interface{}{
			"slug": slug, "chunk": scanner.Text() + "\n",
		})
	}

	// Wait for stderr goroutine to finish
	<-scanDone

	if err := cmd.Wait(); err != nil {
		errMsg := err.Error()
		if ctx.Err() == context.DeadlineExceeded {
			errMsg = "critic timed out after 5 minutes"
		}
		s.globalBroker.broadcastJSON("critic_review_failed", map[string]interface{}{
			"slug": slug, "error": errMsg,
		})
		return
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		return
	}
	if result := protocol.GetCriticReview(manifest); result != nil {
		s.EmitCriticReviewComplete(slug, result)
	}
}

// handleFixCritic serves PATCH /api/impl/{slug}/fix-critic.
// Accepts a CriticFix JSON body, applies the fix to the IMPL manifest YAML,
// re-validates with sawtools validate --fix, and returns the updated CriticResult.
// Emits impl_updated SSE event so other panels refresh.
func (s *Server) handleFixCritic(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	implPath, _ := s.findImplPath(slug)
	if implPath == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "IMPL doc not found"})
		return
	}

	var fix CriticFix
	if err := json.NewDecoder(r.Body).Decode(&fix); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON body: " + err.Error()})
		return
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to load IMPL manifest"})
		return
	}

	switch fix.Type {
	case "add_file_ownership":
		if fix.File == "" || fix.AgentID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "add_file_ownership requires file and agent_id"})
			return
		}
		action := fix.Action
		if action == "" {
			action = "modify"
		}
		manifest.FileOwnership = append(manifest.FileOwnership, protocol.FileOwnership{
			File:   fix.File,
			Agent:  fix.AgentID,
			Wave:   fix.Wave,
			Action: action,
		})

	case "update_contract":
		if fix.ContractName == "" || fix.OldSymbol == "" || fix.NewSymbol == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "update_contract requires contract_name, old_symbol, and new_symbol"})
			return
		}
		found := false
		for i, ic := range manifest.InterfaceContracts {
			if ic.Name == fix.ContractName {
				manifest.InterfaceContracts[i].Definition = strings.ReplaceAll(ic.Definition, fix.OldSymbol, fix.NewSymbol)
				found = true
				break
			}
		}
		if !found {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "contract not found: " + fix.ContractName})
			return
		}

	case "add_integration_connector":
		if fix.File == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "add_integration_connector requires file"})
			return
		}
		reason := "added via critic fix"
		if fix.AgentID != "" {
			reason = "wiring for agent " + fix.AgentID
		}
		manifest.IntegrationConnectors = append(manifest.IntegrationConnectors, protocol.IntegrationConnector{
			File:   fix.File,
			Reason: reason,
		})

	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "unknown fix type: " + fix.Type})
		return
	}

	if err := protocol.Save(manifest, implPath); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to save manifest: " + err.Error()})
		return
	}

	// Re-validate with sawtools validate --fix
	_ = exec.Command("sawtools", "validate", "--fix", implPath).Run() //nolint:gosec

	// Reload manifest to get updated state (including any validator auto-fixes)
	manifest, err = protocol.Load(implPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to reload manifest after fix"})
		return
	}

	// Broadcast update so other panels refresh
	s.globalBroker.broadcastJSON("impl_updated", map[string]interface{}{"slug": slug})

	// Return the critic report (may be nil if no review exists yet)
	w.Header().Set("Content-Type", "application/json")
	if manifest.CriticReport != nil {
		json.NewEncoder(w).Encode(manifest.CriticReport)
	} else {
		w.Write([]byte("null")) //nolint:errcheck
	}
}

// AutoFixCriticRequest is the JSON request body for POST /api/impl/{slug}/auto-fix-critic.
type AutoFixCriticRequest struct {
	DryRun bool `json:"dry_run,omitempty"` // if true, return planned fixes without applying
}

// AutoFixCriticResponse is the JSON response from the auto-fix-critic endpoint.
type AutoFixCriticResponse struct {
	FixesApplied []AppliedFix           `json:"fixes_applied"`
	FixesFailed  []FailedFix            `json:"fixes_failed"`
	NewResult    *protocol.CriticResult `json:"new_result,omitempty"` // nil if dry_run
	AllResolved  bool                   `json:"all_resolved"`
}

// AppliedFix describes a single fix that was successfully applied.
type AppliedFix struct {
	Check       string `json:"check"`       // e.g. "file_existence"
	AgentID     string `json:"agent_id"`
	Description string `json:"description"` // human-readable summary
}

// FailedFix describes a single fix that could not be applied.
type FailedFix struct {
	Check   string `json:"check"`
	AgentID string `json:"agent_id"`
	Reason  string `json:"reason"` // why auto-fix failed
}

// autoFixCriticTimeout is the maximum duration for the critic re-run during auto-fix.
var autoFixCriticTimeout = 3 * time.Minute

// validateCommandFunc creates the exec.Cmd for sawtools validate --fix.
// Overridable in tests.
var validateCommandFunc = func(implPath string) *exec.Cmd {
	return exec.Command("sawtools", "validate", "--fix", implPath) //nolint:gosec
}

// symbolAccuracyPattern matches "expected X, found Y" in critic issue descriptions.
var symbolAccuracyPattern = regexp.MustCompile(`expected\s+(\S+),\s+found\s+(\S+)`)

// RegisterAutoFixRoutes registers the auto-fix-critic endpoint on the server mux.
// This will be wired into the main route registration during integration.
func (s *Server) RegisterAutoFixRoutes() {
	s.mux.HandleFunc("POST /api/impl/{slug}/auto-fix-critic", s.handleAutoFixCritic)
}

// handleAutoFixCritic serves POST /api/impl/{slug}/auto-fix-critic.
// Reads the existing critic report, determines which errors are auto-fixable,
// applies fixes, re-validates, re-runs critic, and returns results.
func (s *Server) handleAutoFixCritic(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	implPath, _ := s.findImplPath(slug)
	if implPath == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "IMPL doc not found"})
		return
	}

	var req AutoFixCriticRequest
	if r.Body != nil && r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON body: " + err.Error()})
			return
		}
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to load IMPL manifest"})
		return
	}

	criticReport := protocol.GetCriticReview(manifest)
	if criticReport == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "no critic report exists for this IMPL"})
		return
	}

	s.globalBroker.broadcastJSON("critic_autofix_started", map[string]string{"slug": slug})

	var applied []AppliedFix
	var failed []FailedFix

	// Classify and apply fixes for each agent's issues
	for agentID, agentReview := range criticReport.AgentReviews {
		for _, issue := range agentReview.Issues {
			switch {
			case (issue.Check == "file_existence" || issue.Check == "side_effect_completeness") &&
				issue.Severity == protocol.CriticSeverityError && issue.File != "":
				// Auto-fix: add file ownership
				if !req.DryRun {
					manifest.FileOwnership = append(manifest.FileOwnership, protocol.FileOwnership{
						File:   issue.File,
						Agent:  agentID,
						Wave:   findAgentWave(manifest, agentID),
						Action: "modify",
					})
				}
				applied = append(applied, AppliedFix{
					Check:       issue.Check,
					AgentID:     agentID,
					Description: fmt.Sprintf("added file ownership for %s to agent %s", issue.File, agentID),
				})

			case issue.Check == "symbol_accuracy":
				matches := symbolAccuracyPattern.FindStringSubmatch(issue.Description)
				if len(matches) == 3 {
					oldSym := matches[1]
					newSym := matches[2]
					if !req.DryRun {
						for i, ic := range manifest.InterfaceContracts {
							manifest.InterfaceContracts[i].Definition = strings.ReplaceAll(ic.Definition, oldSym, newSym)
						}
					}
					applied = append(applied, AppliedFix{
						Check:       issue.Check,
						AgentID:     agentID,
						Description: fmt.Sprintf("updated contract symbol %s -> %s", oldSym, newSym),
					})
				} else {
					failed = append(failed, FailedFix{
						Check:   issue.Check,
						AgentID: agentID,
						Reason:  "no auto-fix available",
					})
				}

			default:
				failed = append(failed, FailedFix{
					Check:   issue.Check,
					AgentID: agentID,
					Reason:  "no auto-fix available",
				})
			}
		}
	}

	resp := AutoFixCriticResponse{
		FixesApplied: applied,
		FixesFailed:  failed,
	}
	// Ensure slices are non-nil for JSON serialization
	if resp.FixesApplied == nil {
		resp.FixesApplied = []AppliedFix{}
	}
	if resp.FixesFailed == nil {
		resp.FixesFailed = []FailedFix{}
	}

	if req.DryRun {
		resp.AllResolved = len(failed) == 0 && len(applied) > 0
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		s.globalBroker.broadcastJSON("critic_autofix_complete", map[string]interface{}{
			"slug": slug, "dry_run": true, "all_resolved": resp.AllResolved,
		})
		return
	}

	// Save manifest with applied fixes
	if err := protocol.Save(manifest, implPath); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to save manifest: " + err.Error()})
		return
	}

	// Re-validate with sawtools validate --fix
	_ = validateCommandFunc(implPath).Run()

	// Re-run critic synchronously with timeout
	ctx, cancel := context.WithTimeout(context.Background(), autoFixCriticTimeout)
	defer cancel()
	cmd := criticCommandFunc(ctx, implPath)
	_ = cmd.Run()

	// Reload manifest to get updated critic result
	manifest, err = protocol.Load(implPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to reload manifest after fix"})
		return
	}

	resp.NewResult = protocol.GetCriticReview(manifest)
	if resp.NewResult != nil {
		resp.AllResolved = resp.NewResult.Verdict == protocol.CriticVerdictPass
	} else {
		resp.AllResolved = len(failed) == 0 && len(applied) > 0
	}

	s.globalBroker.broadcastJSON("critic_autofix_complete", map[string]interface{}{
		"slug": slug, "dry_run": false, "all_resolved": resp.AllResolved,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// findAgentWave returns the wave number for a given agent ID, defaulting to 1.
func findAgentWave(manifest *protocol.IMPLManifest, agentID string) int {
	for _, wave := range manifest.Waves {
		for _, agent := range wave.Agents {
			if agent.ID == agentID {
				return wave.Number
			}
		}
	}
	return 1
}

// criticThresholdMet returns true when an IMPL warrants automatic critic gating:
// wave 1 has 3+ agents OR file ownership spans 2+ distinct repos.
func criticThresholdMet(manifest *protocol.IMPLManifest) bool {
	for _, wave := range manifest.Waves {
		if wave.Number == 1 && len(wave.Agents) >= 3 {
			return true
		}
	}
	repos := make(map[string]struct{})
	for _, fo := range manifest.FileOwnership {
		if fo.Repo != "" {
			repos[fo.Repo] = struct{}{}
		}
	}
	return len(repos) >= 2
}

