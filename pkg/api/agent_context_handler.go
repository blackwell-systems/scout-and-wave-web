package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// handleGetAgentContext serves GET /api/impl/{slug}/agent/{letter}/context.
// Parses the IMPL doc to extract the agent's prompt section, interface contracts,
// and file ownership rows, then returns them as AgentContextResponse JSON.
func (s *Server) handleGetAgentContext(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	letter := strings.ToUpper(r.PathValue("letter"))
	if slug == "" || letter == "" {
		http.Error(w, "missing slug or agent letter", http.StatusBadRequest)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")

	manifest, err := protocol.Load(implPath)
	if err != nil {
		http.Error(w, "IMPL manifest not found", http.StatusNotFound)
		return
	}

	// Use protocol's ExtractAgentContextFromManifest
	payload, err := protocol.ExtractAgentContextFromManifest(manifest, letter)
	if err != nil {
		http.Error(w, "agent not found in manifest", http.StatusNotFound)
		return
	}

	// Find the agent's wave number
	agentWave := 0
	for _, wave := range manifest.Waves {
		for _, agent := range wave.Agents {
			if strings.EqualFold(agent.ID, letter) {
				agentWave = wave.Number
				break
			}
		}
		if agentWave != 0 {
			break
		}
	}

	resp := AgentContextResponse{
		Slug:        slug,
		Agent:       letter,
		Wave:        agentWave,
		ContextText: payload.AgentTask,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

