package api

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
)

// handleGetConfig serves GET /api/config.
// Reads saw.config.json from the repo root and returns it as SAWConfig JSON.
// If the file does not exist, returns a default SAWConfig{}.
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	deps := service.Deps{
		RepoPath: s.cfg.RepoPath,
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}

	cfg, err := service.GetConfig(deps)
	if err != nil {
		http.Error(w, "failed to read config", http.StatusInternalServerError)
		return
	}

	// Convert service types to API types for response
	apiCfg := SAWConfig{
		Repos: make([]RepoEntry, len(cfg.Repos)),
		Agent: AgentConfig{
			ScoutModel:       cfg.Agent.ScoutModel,
			WaveModel:        cfg.Agent.WaveModel,
			ChatModel:        cfg.Agent.ChatModel,
			ScaffoldModel:    cfg.Agent.ScaffoldModel,
			IntegrationModel: cfg.Agent.IntegrationModel,
			PlannerModel:     cfg.Agent.PlannerModel,
			ReviewModel:      cfg.Agent.ReviewModel,
		},
		Quality: QualityConfig{
			RequireTests:   cfg.Quality.RequireTests,
			RequireLint:    cfg.Quality.RequireLint,
			BlockOnFailure: cfg.Quality.BlockOnFailure,
			CodeReview: CodeReviewCfg{
				Enabled:   cfg.Quality.CodeReview.Enabled,
				Blocking:  cfg.Quality.CodeReview.Blocking,
				Model:     cfg.Quality.CodeReview.Model,
				Threshold: cfg.Quality.CodeReview.Threshold,
			},
		},
		Appear: AppearConfig{
			Theme:               cfg.Appear.Theme,
			ColorTheme:          cfg.Appear.ColorTheme,
			ColorThemeDark:      cfg.Appear.ColorThemeDark,
			ColorThemeLight:     cfg.Appear.ColorThemeLight,
			FavoriteThemesDark:  cfg.Appear.FavoriteThemesDark,
			FavoriteThemesLight: cfg.Appear.FavoriteThemesLight,
		},
		Providers: ProvidersConfig{
			Anthropic: AnthropicProviderConfig{APIKey: cfg.Providers.Anthropic.APIKey},
			OpenAI:    OpenAIProviderConfig{APIKey: cfg.Providers.OpenAI.APIKey},
			Bedrock: BedrockProviderConfig{
				Region:         cfg.Providers.Bedrock.Region,
				AccessKeyID:    cfg.Providers.Bedrock.AccessKeyID,
				SecretAccessKey: cfg.Providers.Bedrock.SecretAccessKey,
				SessionToken:   cfg.Providers.Bedrock.SessionToken,
			},
		},
	}
	for i, repo := range cfg.Repos {
		apiCfg.Repos[i] = RepoEntry{Name: repo.Name, Path: repo.Path}
	}

	respondJSON(w, http.StatusOK, apiCfg)
}

// handleSaveConfig serves POST /api/config.
// Decodes SAWConfig JSON body and atomically writes it to saw.config.json.
func (s *Server) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	var apiCfg SAWConfig
	if err := decodeJSON(r, &apiCfg); err != nil {
		respondError(w, "invalid config JSON", http.StatusBadRequest)
		return
	}

	// Convert API types to service types
	svcCfg := &service.SAWConfig{
		Repos: make([]service.RepoEntry, len(apiCfg.Repos)),
		Agent: service.AgentConfig{
			ScoutModel:       apiCfg.Agent.ScoutModel,
			WaveModel:        apiCfg.Agent.WaveModel,
			ChatModel:        apiCfg.Agent.ChatModel,
			ScaffoldModel:    apiCfg.Agent.ScaffoldModel,
			IntegrationModel: apiCfg.Agent.IntegrationModel,
			PlannerModel:     apiCfg.Agent.PlannerModel,
			ReviewModel:      apiCfg.Agent.ReviewModel,
		},
		Quality: service.QualityConfig{
			RequireTests:   apiCfg.Quality.RequireTests,
			RequireLint:    apiCfg.Quality.RequireLint,
			BlockOnFailure: apiCfg.Quality.BlockOnFailure,
			CodeReview: service.CodeReviewCfg{
				Enabled:   apiCfg.Quality.CodeReview.Enabled,
				Blocking:  apiCfg.Quality.CodeReview.Blocking,
				Model:     apiCfg.Quality.CodeReview.Model,
				Threshold: apiCfg.Quality.CodeReview.Threshold,
			},
		},
		Appear: service.AppearConfig{
			Theme:               apiCfg.Appear.Theme,
			ColorTheme:          apiCfg.Appear.ColorTheme,
			ColorThemeDark:      apiCfg.Appear.ColorThemeDark,
			ColorThemeLight:     apiCfg.Appear.ColorThemeLight,
			FavoriteThemesDark:  apiCfg.Appear.FavoriteThemesDark,
			FavoriteThemesLight: apiCfg.Appear.FavoriteThemesLight,
		},
		Providers: service.ProvidersConfig{
			Anthropic: service.AnthropicProviderConfig{APIKey: apiCfg.Providers.Anthropic.APIKey},
			OpenAI:    service.OpenAIProviderConfig{APIKey: apiCfg.Providers.OpenAI.APIKey},
			Bedrock: service.BedrockProviderConfig{
				Region:         apiCfg.Providers.Bedrock.Region,
				AccessKeyID:    apiCfg.Providers.Bedrock.AccessKeyID,
				SecretAccessKey: apiCfg.Providers.Bedrock.SecretAccessKey,
				SessionToken:   apiCfg.Providers.Bedrock.SessionToken,
			},
		},
	}
	for i, repo := range apiCfg.Repos {
		svcCfg.Repos[i] = service.RepoEntry{Name: repo.Name, Path: repo.Path}
	}

	deps := service.Deps{
		RepoPath: s.cfg.RepoPath,
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}

	if err := service.SaveConfig(deps, svcCfg); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
		}
		if err := decodeJSON(r, &body); err != nil {
			respondError(w, "invalid request body", http.StatusBadRequest)
			return
		}
		identity, err := service.ValidateBedrockCredentials(
			body.Region, body.AccessKeyID, body.SecretAccessKey, body.SessionToken,
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
