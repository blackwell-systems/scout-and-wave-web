package api

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"strings"

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

// runCriticAsync invokes sawtools run-critic and emits critic_review_complete
// when done. Safe to call in a goroutine.
func (s *Server) runCriticAsync(slug, implPath string) {
	cmd := exec.Command("sawtools", "run-critic", implPath) //nolint:gosec
	if err := cmd.Run(); err != nil {
		return // critic failure is non-fatal; UI retains prior state
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

