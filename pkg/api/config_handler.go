package api

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
)

// handleGetConfig serves GET /api/config.
// Reads saw.config.json from the repo root and returns it as SAWConfig JSON.
// If the file does not exist, returns a default SAWConfig{}.
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := config.LoadOrDefault(s.cfg.RepoPath)

	// If no repos configured, add the server's repo as fallback.
	if len(cfg.Repos) == 0 {
		cfg.Repos = []config.RepoEntry{{
			Name: filepath.Base(s.cfg.RepoPath),
			Path: s.cfg.RepoPath,
		}}
	}

	respondJSON(w, http.StatusOK, cfg)
}

// handleSaveConfig serves POST /api/config.
// Decodes SAWConfig JSON body and atomically writes it to saw.config.json.
func (s *Server) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	var cfg config.SAWConfig
	if err := decodeJSON(r, &cfg); err != nil {
		respondError(w, "invalid config JSON", http.StatusBadRequest)
		return
	}

	// Validate model names via the service layer.
	models := map[string]string{
		"scout_model":       cfg.Agent.ScoutModel,
		"wave_model":        cfg.Agent.WaveModel,
		"chat_model":        cfg.Agent.ChatModel,
		"integration_model": cfg.Agent.IntegrationModel,
		"review_model":      cfg.Agent.ReviewModel,
	}
	for field, model := range models {
		if err := service.ValidateModelName(model); err != nil {
			respondError(w, "invalid "+field+": "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	saveResult := config.Save(s.cfg.RepoPath, &cfg)
	if !saveResult.IsSuccess() {
		msg := "failed to save config"
		if len(saveResult.Errors) > 0 {
			msg = saveResult.Errors[0].Message
		}
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// handleValidateProvider serves POST /api/config/providers/{provider}/validate.
// It validates provider-specific credentials and returns a ProviderValidationResponse.
func (s *Server) handleValidateProvider(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")

	switch strings.ToLower(provider) {
	case "anthropic":
		var body struct {
			APIKey string `json:"api_key"`
		}
		if err := decodeJSON(r, &body); err != nil {
			respondError(w, "invalid request body", http.StatusBadRequest)
			return
		}
		err := service.ValidateAnthropicCredentials(body.APIKey)
		if err != nil {
			respondJSON(w, http.StatusOK, ProviderValidationResponse{
				Valid: false,
				Error: err.Error(),
			})
			return
		}
		respondJSON(w, http.StatusOK, ProviderValidationResponse{Valid: true})

	case "openai":
		var body struct {
			APIKey string `json:"api_key"`
		}
		if err := decodeJSON(r, &body); err != nil {
			respondError(w, "invalid request body", http.StatusBadRequest)
			return
		}
		err := service.ValidateOpenAICredentials(body.APIKey)
		if err != nil {
			respondJSON(w, http.StatusOK, ProviderValidationResponse{
				Valid: false,
				Error: err.Error(),
			})
			return
		}
		respondJSON(w, http.StatusOK, ProviderValidationResponse{Valid: true})

	case "bedrock":
		var body struct {
			Region         string `json:"region"`
			AccessKeyID    string `json:"access_key_id"`
			SecretAccessKey string `json:"secret_access_key"`
			SessionToken   string `json:"session_token"`
			Profile        string `json:"profile"`
		}
		if err := decodeJSON(r, &body); err != nil {
			respondError(w, "invalid request body", http.StatusBadRequest)
			return
		}
		identity, err := service.ValidateBedrockCredentials(
			body.Region, body.AccessKeyID, body.SecretAccessKey, body.SessionToken, body.Profile,
		)
		if err != nil {
			respondJSON(w, http.StatusOK, ProviderValidationResponse{
				Valid: false,
				Error: err.Error(),
			})
			return
		}
		respondJSON(w, http.StatusOK, ProviderValidationResponse{
			Valid:    true,
			Identity: identity,
		})

	default:
		respondError(w, "unknown provider: "+provider, http.StatusBadRequest)
	}
}
