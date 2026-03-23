package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// testDeps creates a Deps pointing at a temp directory for testing.
func testDeps(t *testing.T) Deps {
	t.Helper()
	dir := t.TempDir()
	return Deps{
		RepoPath: dir,
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}
}

func TestGetConfig_NoFile_ReturnsDefault(t *testing.T) {
	deps := testDeps(t)

	cfg, err := GetConfig(deps)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(cfg.Repos) != 1 {
		t.Fatalf("expected 1 repo entry, got %d", len(cfg.Repos))
	}
	if cfg.Repos[0].Path != deps.RepoPath {
		t.Errorf("expected repo path %s, got %s", deps.RepoPath, cfg.Repos[0].Path)
	}
	// Name should be the base directory name
	expectedName := filepath.Base(deps.RepoPath)
	if cfg.Repos[0].Name != expectedName {
		t.Errorf("expected repo name %q, got %q", expectedName, cfg.Repos[0].Name)
	}
}

func TestGetConfig_WithLegacyRepoPath(t *testing.T) {
	deps := testDeps(t)

	// Write a config with the legacy repo.path field only
	legacy := map[string]interface{}{
		"repo": map[string]string{"path": "/old/repo"},
	}
	data, _ := json.Marshal(legacy)
	os.WriteFile(deps.ConfigPath(deps.RepoPath), data, 0644)

	cfg, err := GetConfig(deps)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(cfg.Repos) != 1 {
		t.Fatalf("expected 1 repo, got %d", len(cfg.Repos))
	}
	if cfg.Repos[0].Path != "/old/repo" {
		t.Errorf("expected legacy path /old/repo, got %s", cfg.Repos[0].Path)
	}
	// Legacy repo field should be cleared
	if cfg.Repo.Path != "" {
		t.Errorf("expected legacy repo field to be cleared, got %q", cfg.Repo.Path)
	}
}

func TestSaveConfig_AtomicWrite(t *testing.T) {
	deps := testDeps(t)

	cfg := &SAWConfig{
		Repos: []RepoEntry{{Name: "test", Path: "/test/path"}},
		Agent: AgentConfig{ScoutModel: "claude-3"},
	}

	if err := SaveConfig(deps, cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	// Verify file was written
	configPath := deps.ConfigPath(deps.RepoPath)
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read saved config: %v", err)
	}

	var saved SAWConfig
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatalf("failed to parse saved config: %v", err)
	}

	if len(saved.Repos) != 1 || saved.Repos[0].Name != "test" {
		t.Errorf("unexpected repos: %+v", saved.Repos)
	}
	if saved.Agent.ScoutModel != "claude-3" {
		t.Errorf("expected scout_model claude-3, got %s", saved.Agent.ScoutModel)
	}
	// Legacy repo field should be cleared
	if saved.Repo.Path != "" {
		t.Errorf("legacy repo field should be cleared, got %q", saved.Repo.Path)
	}
}

func TestSaveConfig_InvalidModel(t *testing.T) {
	deps := testDeps(t)

	cfg := &SAWConfig{
		Agent: AgentConfig{ScoutModel: "bad model name!"},
	}

	err := SaveConfig(deps, cfg)
	if err == nil {
		t.Fatal("expected error for invalid model name")
	}
}

func TestValidateModelName_InvalidChars(t *testing.T) {
	tests := []struct {
		name    string
		model   string
		wantErr bool
	}{
		{"empty is ok", "", false},
		{"simple valid", "claude-3", false},
		{"with dots and colons", "anthropic:claude-3.5-sonnet", false},
		{"with slashes", "org/model-v2", false},
		{"with spaces", "bad model", true},
		{"with semicolons", "model;rm -rf /", true},
		{"with backticks", "model`whoami`", true},
		{"too long", string(make([]byte, 201)), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateModelName(tt.model)
			if tt.wantErr && err == nil {
				t.Errorf("expected error for %q", tt.model)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error for %q: %v", tt.model, err)
			}
		})
	}
}

func TestGetConfiguredRepos_Fallback(t *testing.T) {
	deps := testDeps(t)

	repos := GetConfiguredRepos(deps)
	if len(repos) != 1 {
		t.Fatalf("expected 1 repo, got %d", len(repos))
	}
	if repos[0].Path != deps.RepoPath {
		t.Errorf("expected fallback to deps.RepoPath")
	}
}

func TestSaveConfig_ProvidersRoundTrip(t *testing.T) {
	deps := testDeps(t)

	cfg := &SAWConfig{
		Repos: []RepoEntry{{Name: "test", Path: "/test/path"}},
		Providers: ProvidersConfig{
			Anthropic: AnthropicProviderConfig{APIKey: "sk-ant-test"},
			OpenAI:    OpenAIProviderConfig{APIKey: "sk-openai-test"},
			Bedrock: BedrockProviderConfig{
				Region:         "us-east-1",
				AccessKeyID:    "AKIATEST",
				SecretAccessKey: "secret123",
				SessionToken:   "token456",
			},
		},
	}

	if err := SaveConfig(deps, cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	loaded, err := GetConfig(deps)
	if err != nil {
		t.Fatalf("GetConfig failed: %v", err)
	}

	if loaded.Providers.Anthropic.APIKey != "sk-ant-test" {
		t.Errorf("expected anthropic key sk-ant-test, got %s", loaded.Providers.Anthropic.APIKey)
	}
	if loaded.Providers.OpenAI.APIKey != "sk-openai-test" {
		t.Errorf("expected openai key sk-openai-test, got %s", loaded.Providers.OpenAI.APIKey)
	}
	if loaded.Providers.Bedrock.Region != "us-east-1" {
		t.Errorf("expected bedrock region us-east-1, got %s", loaded.Providers.Bedrock.Region)
	}
	if loaded.Providers.Bedrock.AccessKeyID != "AKIATEST" {
		t.Errorf("expected bedrock access key AKIATEST, got %s", loaded.Providers.Bedrock.AccessKeyID)
	}
	if loaded.Providers.Bedrock.SecretAccessKey != "secret123" {
		t.Errorf("expected bedrock secret key, got %s", loaded.Providers.Bedrock.SecretAccessKey)
	}
	if loaded.Providers.Bedrock.SessionToken != "token456" {
		t.Errorf("expected bedrock session token, got %s", loaded.Providers.Bedrock.SessionToken)
	}
}

func TestSaveConfig_EmptyProviders_OmittedFromJSON(t *testing.T) {
	deps := testDeps(t)

	cfg := &SAWConfig{
		Repos: []RepoEntry{{Name: "test", Path: "/test/path"}},
	}

	if err := SaveConfig(deps, cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	// Read raw JSON and verify providers is omitted when empty
	data, err := os.ReadFile(deps.ConfigPath(deps.RepoPath))
	if err != nil {
		t.Fatalf("failed to read config: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}

	// Empty providers should still be present but with empty sub-objects
	// (omitempty on individual fields means empty strings are omitted)
	loaded, err := GetConfig(deps)
	if err != nil {
		t.Fatalf("GetConfig failed: %v", err)
	}
	if loaded.Providers.Anthropic.APIKey != "" {
		t.Errorf("expected empty anthropic key, got %q", loaded.Providers.Anthropic.APIKey)
	}
}

func TestValidateAnthropicCredentials_EmptyKey(t *testing.T) {
	err := ValidateAnthropicCredentials("")
	if err == nil {
		t.Fatal("expected error for empty key")
	}
	if err.Error() != "API key is required" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidateOpenAICredentials_EmptyKey(t *testing.T) {
	err := ValidateOpenAICredentials("")
	if err == nil {
		t.Fatal("expected error for empty key")
	}
	if err.Error() != "API key is required" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidateBedrockCredentials_MissingFields(t *testing.T) {
	_, err := ValidateBedrockCredentials("", "AKIA", "secret", "")
	if err == nil {
		t.Fatal("expected error for empty region")
	}

	_, err = ValidateBedrockCredentials("us-east-1", "", "secret", "")
	if err == nil {
		t.Fatal("expected error for empty access key")
	}

	_, err = ValidateBedrockCredentials("us-east-1", "AKIA", "", "")
	if err == nil {
		t.Fatal("expected error for empty secret key")
	}
}

func TestGetConfiguredRepos_FromFile(t *testing.T) {
	deps := testDeps(t)

	cfg := SAWConfig{
		Repos: []RepoEntry{
			{Name: "alpha", Path: "/alpha"},
			{Name: "beta", Path: "/beta"},
		},
	}
	data, _ := json.Marshal(cfg)
	os.WriteFile(deps.ConfigPath(deps.RepoPath), data, 0644)

	repos := GetConfiguredRepos(deps)
	if len(repos) != 2 {
		t.Fatalf("expected 2 repos, got %d", len(repos))
	}
	if repos[0].Name != "alpha" || repos[1].Name != "beta" {
		t.Errorf("unexpected repos: %+v", repos)
	}
}
