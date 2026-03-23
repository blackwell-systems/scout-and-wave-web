package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// RepoEntry is one named repository in the repo registry.
type RepoEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// RepoConfig is kept for backward-compat JSON deserialization of old configs.
type RepoConfig struct {
	Path string `json:"path"`
}

// ProvidersConfig holds credential configuration for all supported LLM providers.
type ProvidersConfig struct {
	Anthropic AnthropicProviderConfig `json:"anthropic"`
	OpenAI    OpenAIProviderConfig    `json:"openai"`
	Bedrock   BedrockProviderConfig   `json:"bedrock"`
}

// AnthropicProviderConfig holds Anthropic API credentials.
type AnthropicProviderConfig struct {
	APIKey string `json:"api_key,omitempty"`
}

// OpenAIProviderConfig holds OpenAI API credentials.
type OpenAIProviderConfig struct {
	APIKey string `json:"api_key,omitempty"`
}

// BedrockProviderConfig holds AWS Bedrock credentials.
type BedrockProviderConfig struct {
	Region         string `json:"region,omitempty"`
	AccessKeyID    string `json:"access_key_id,omitempty"`
	SecretAccessKey string `json:"secret_access_key,omitempty"`
	SessionToken   string `json:"session_token,omitempty"`
}

// SAWConfig is the shape of saw.config.json and the GET/POST /api/config body.
type SAWConfig struct {
	Repos     []RepoEntry     `json:"repos,omitempty"`
	Repo      RepoConfig      `json:"repo,omitempty"`
	Agent     AgentConfig     `json:"agent"`
	Quality   QualityConfig   `json:"quality"`
	Appear    AppearConfig    `json:"appearance"`
	Providers ProvidersConfig `json:"providers,omitempty"`
}

// AgentConfig holds model names for each agent type.
type AgentConfig struct {
	ScoutModel       string `json:"scout_model"`
	WaveModel        string `json:"wave_model"`
	ChatModel        string `json:"chat_model"`
	ScaffoldModel    string `json:"scaffold_model"`
	IntegrationModel string `json:"integration_model"`
	PlannerModel     string `json:"planner_model"`
	ReviewModel      string `json:"review_model"`
}

// QualityConfig holds quality enforcement settings.
type QualityConfig struct {
	RequireTests   bool          `json:"require_tests"`
	RequireLint    bool          `json:"require_lint"`
	BlockOnFailure bool          `json:"block_on_failure"`
	CodeReview     CodeReviewCfg `json:"code_review"`
}

// CodeReviewCfg holds settings for the AI code review post-merge gate.
type CodeReviewCfg struct {
	Enabled   bool   `json:"enabled"`
	Blocking  bool   `json:"blocking"`
	Model     string `json:"model"`
	Threshold int    `json:"threshold"`
}

// AppearConfig holds appearance/theme settings.
type AppearConfig struct {
	Theme               string   `json:"theme"`
	Contrast            string   `json:"contrast,omitempty"`
	ColorTheme          string   `json:"color_theme,omitempty"`
	ColorThemeDark      string   `json:"color_theme_dark,omitempty"`
	ColorThemeLight     string   `json:"color_theme_light,omitempty"`
	FavoriteThemesDark  []string `json:"favorite_themes_dark,omitempty"`
	FavoriteThemesLight []string `json:"favorite_themes_light,omitempty"`
}

// ValidateModelName ensures a model name contains only safe characters.
// Returns nil for empty strings (falls back to defaults).
func ValidateModelName(model string) error {
	if model == "" {
		return nil
	}
	if len(model) > 200 {
		return fmt.Errorf("model name too long (max 200 chars)")
	}
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9:._/-]+$`, model)
	if !matched {
		return fmt.Errorf("model name contains invalid characters")
	}
	return nil
}

// GetConfig reads saw.config.json from the repo and returns a SAWConfig.
// If the config file does not exist, returns a default config with the
// repo from deps.RepoPath as the single entry.
func GetConfig(deps Deps) (*SAWConfig, error) {
	configPath := deps.ConfigPath(deps.RepoPath)
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			repoName := filepath.Base(deps.RepoPath)
			return &SAWConfig{
				Repos: []RepoEntry{{Name: repoName, Path: deps.RepoPath}},
			}, nil
		}
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var cfg SAWConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// Backward-compat: if no repos registry, use legacy repo.path or server startup repo
	if len(cfg.Repos) == 0 {
		if cfg.Repo.Path != "" {
			cfg.Repos = []RepoEntry{{Name: "repo", Path: cfg.Repo.Path}}
		} else {
			repoName := filepath.Base(deps.RepoPath)
			cfg.Repos = []RepoEntry{{Name: repoName, Path: deps.RepoPath}}
		}
	}
	cfg.Repo = RepoConfig{} // clear legacy field from response

	return &cfg, nil
}

// SaveConfig validates model names and atomically writes the config to
// saw.config.json (temp file + rename).
func SaveConfig(deps Deps, cfg *SAWConfig) error {
	// Validate all model name fields
	models := map[string]string{
		"scout_model":       cfg.Agent.ScoutModel,
		"wave_model":        cfg.Agent.WaveModel,
		"chat_model":        cfg.Agent.ChatModel,
		"integration_model": cfg.Agent.IntegrationModel,
		"review_model":      cfg.Agent.ReviewModel,
	}
	for field, model := range models {
		if err := ValidateModelName(model); err != nil {
			return fmt.Errorf("invalid %s: %w", field, err)
		}
	}

	cfg.Repo = RepoConfig{} // ensure legacy field is never written back

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	configPath := deps.ConfigPath(deps.RepoPath)

	// Atomic write: write to temp file in same directory, then rename
	tmpFile, err := os.CreateTemp(filepath.Dir(configPath), "saw-config-*.json.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath) // clean up if rename fails

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		return fmt.Errorf("failed to write temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("failed to close temp file: %w", err)
	}
	if err := os.Rename(tmpPath, configPath); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

// validationTimeout is the maximum time allowed for credential validation calls.
const validationTimeout = 5 * time.Second

// ValidateAnthropicCredentials validates an Anthropic API key by calling
// GET /v1/models. Returns nil if the key is valid.
func ValidateAnthropicCredentials(apiKey string) error {
	if apiKey == "" {
		return fmt.Errorf("API key is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), validationTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.anthropic.com/v1/models", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("invalid API key")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return nil
}

// ValidateOpenAICredentials validates an OpenAI API key by calling
// GET /v1/models. Returns nil if the key is valid.
func ValidateOpenAICredentials(apiKey string) error {
	if apiKey == "" {
		return fmt.Errorf("API key is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), validationTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.openai.com/v1/models", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("invalid API key")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return nil
}

// ValidateBedrockCredentials validates AWS credentials by calling STS
// GetCallerIdentity. Returns the caller identity ARN on success.
func ValidateBedrockCredentials(region, accessKeyID, secretKey, sessionToken string) (string, error) {
	if region == "" {
		return "", fmt.Errorf("region is required")
	}
	if accessKeyID == "" || secretKey == "" {
		return "", fmt.Errorf("access key ID and secret key are required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), validationTimeout)
	defer cancel()

	creds := credentials.NewStaticCredentialsProvider(accessKeyID, secretKey, sessionToken)
	stsClient := sts.New(sts.Options{
		Region:           region,
		Credentials:      creds,
		RetryMaxAttempts: 1,
	})

	result, err := stsClient.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return "", fmt.Errorf("invalid credentials: %w", err)
	}

	arn := ""
	if result.Arn != nil {
		arn = *result.Arn
	}
	return arn, nil
}

// GetConfiguredRepos reads the config and returns the repo list.
// Falls back to a single entry using deps.RepoPath if no config exists.
func GetConfiguredRepos(deps Deps) []RepoEntry {
	cfg, err := GetConfig(deps)
	if err != nil || len(cfg.Repos) == 0 {
		repoName := filepath.Base(deps.RepoPath)
		return []RepoEntry{{Name: repoName, Path: deps.RepoPath}}
	}
	return cfg.Repos
}
