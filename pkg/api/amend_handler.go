package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// AmendImplRequest is the JSON body for POST /api/impl/{slug}/amend.
type AmendImplRequest struct {
	Operation string `json:"operation"`          // "add-wave" | "redirect-agent" | "extend-scope"
	AgentID   string `json:"agent_id,omitempty"`
	WaveNum   int    `json:"wave_num,omitempty"`
	NewTask   string `json:"new_task,omitempty"`
}

// AmendImplResponse is returned by POST /api/impl/{slug}/amend.
type AmendImplResponse struct {
	Success       bool     `json:"success"`
	Operation     string   `json:"operation"`
	NewWaveNumber int      `json:"new_wave_number,omitempty"`
	AgentID       string   `json:"agent_id,omitempty"`
	Warnings      []string `json:"warnings,omitempty"`
	Error         string   `json:"error,omitempty"`
}

// handleAmendImpl handles POST /api/impl/{slug}/amend.
// Accepts AmendImplRequest JSON body. Returns AmendImplResponse.
// HTTP 200 on success, HTTP 409 on ErrAmendBlocked, HTTP 400 on bad input,
// HTTP 500 on system errors.
func (s *Server) handleAmendImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	var req AmendImplRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	validOps := map[string]bool{
		"add-wave":       true,
		"redirect-agent": true,
		"extend-scope":   true,
	}
	if !validOps[req.Operation] {
		http.Error(w, "operation must be one of: add-wave, redirect-agent, extend-scope", http.StatusBadRequest)
		return
	}

	// extend-scope is an orchestrator-level operation; respond immediately
	if req.Operation == "extend-scope" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(AmendImplResponse{ //nolint:errcheck
			Success:   true,
			Operation: "extend-scope",
			Warnings:  []string{"extend-scope: re-launch Scout with IMPL as context (orchestrator-level operation)"},
		})
		return
	}

	implPath, _ := s.findImplPath(slug)
	if implPath == "" {
		http.Error(w, "IMPL doc not found", http.StatusNotFound)
		return
	}

	opts := protocol.AmendImplOpts{
		ManifestPath: implPath,
	}

	switch req.Operation {
	case "add-wave":
		opts.AddWave = true
	case "redirect-agent":
		opts.RedirectAgent = true
		opts.AgentID = req.AgentID
		opts.WaveNum = req.WaveNum
		opts.NewTask = req.NewTask
	}

	result, err := protocol.AmendImpl(opts)
	if err != nil {
		if errors.Is(err, protocol.ErrAmendBlocked) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(AmendImplResponse{ //nolint:errcheck
				Success:   false,
				Operation: req.Operation,
				Error:     err.Error(),
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(AmendImplResponse{ //nolint:errcheck
			Success:   false,
			Operation: req.Operation,
			Error:     err.Error(),
		})
		return
	}

	s.globalBroker.broadcast("impl_list_updated")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(AmendImplResponse{ //nolint:errcheck
		Success:       true,
		Operation:     result.Operation,
		NewWaveNumber: result.NewWaveNumber,
		AgentID:       result.AgentID,
		Warnings:      result.Warnings,
	})
}

// RegisterAmendRoutes registers amend-related HTTP routes on the given mux.
// Called from server.go New() in wave 2.
func (s *Server) RegisterAmendRoutes() {
	s.mux.HandleFunc("POST /api/impl/{slug}/amend", s.handleAmendImpl)
}
