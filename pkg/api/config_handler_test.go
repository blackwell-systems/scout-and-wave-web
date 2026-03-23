package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestConfigMigration_LegacyRepoPath verifies that a legacy saw.config.json
// containing only the old "repo.path" field is automatically migrated to the
// new "repos" registry on GET /api/config, and that the legacy "repo" field
// is cleared from the response.
func TestConfigMigration_LegacyRepoPath(t *testing.T) {
	dir := t.TempDir()

	// Write a legacy config: only the old repo.path field, no repos array.
	legacyJSON := `{"repo":{"path":"/tmp/testrepo"}}`
	configPath := filepath.Join(dir, "saw.config.json")
	if err := os.WriteFile(configPath, []byte(legacyJSON), 0644); err != nil {
		t.Fatalf("failed to write legacy config: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rr := httptest.NewRecorder()
	s.handleGetConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var got SAWConfig
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Assert repos has exactly one entry migrated from legacy repo.path
	if len(got.Repos) != 1 {
		t.Fatalf("expected 1 repo entry, got %d", len(got.Repos))
	}
	if got.Repos[0].Name != "repo" {
		t.Errorf("expected repos[0].name = %q, got %q", "repo", got.Repos[0].Name)
	}
	if got.Repos[0].Path != "/tmp/testrepo" {
		t.Errorf("expected repos[0].path = %q, got %q", "/tmp/testrepo", got.Repos[0].Path)
	}

	// Assert the legacy "repo" field is cleared (empty/zero-value) in the response.
	if got.Repo.Path != "" {
		t.Errorf("expected legacy repo.path to be empty in response, got %q", got.Repo.Path)
	}
}

// TestConfigGetSave_ProvidersRoundTrip verifies that saving a config with
// providers and then loading it returns the providers intact.
func TestConfigGetSave_ProvidersRoundTrip(t *testing.T) {
	dir := t.TempDir()

	configJSON := `{
		"repos":[{"name":"main","path":"/home/user/project"}],
		"providers":{
			"anthropic":{"api_key":"sk-ant-123"},
			"openai":{"api_key":"sk-openai-456"},
			"bedrock":{"region":"us-west-2","access_key_id":"AKIA789"}
		}
	}`
	configPath := filepath.Join(dir, "saw.config.json")
	if err := os.WriteFile(configPath, []byte(configJSON), 0644); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rr := httptest.NewRecorder()
	s.handleGetConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var got SAWConfig
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if got.Providers.Anthropic.APIKey != "sk-ant-123" {
		t.Errorf("expected anthropic key sk-ant-123, got %q", got.Providers.Anthropic.APIKey)
	}
	if got.Providers.OpenAI.APIKey != "sk-openai-456" {
		t.Errorf("expected openai key sk-openai-456, got %q", got.Providers.OpenAI.APIKey)
	}
	if got.Providers.Bedrock.Region != "us-west-2" {
		t.Errorf("expected bedrock region us-west-2, got %q", got.Providers.Bedrock.Region)
	}
	if got.Providers.Bedrock.AccessKeyID != "AKIA789" {
		t.Errorf("expected bedrock access key AKIA789, got %q", got.Providers.Bedrock.AccessKeyID)
	}
}

// TestValidateProvider_UnknownProvider verifies that an unknown provider returns 400.
func TestValidateProvider_UnknownProvider(t *testing.T) {
	dir := t.TempDir()

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/unknown/validate", strings.NewReader(`{}`))
	req.SetPathValue("provider", "unknown")
	rr := httptest.NewRecorder()
	s.handleValidateProvider(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for unknown provider, got %d; body: %s", rr.Code, rr.Body.String())
	}
}

// TestValidateProvider_AnthropicEmptyKey verifies that empty anthropic key returns valid=false.
func TestValidateProvider_AnthropicEmptyKey(t *testing.T) {
	dir := t.TempDir()

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/anthropic/validate", strings.NewReader(`{"api_key":""}`))
	req.SetPathValue("provider", "anthropic")
	rr := httptest.NewRecorder()
	s.handleValidateProvider(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var resp ProviderValidationResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Valid {
		t.Error("expected valid=false for empty key")
	}
	if resp.Error == "" {
		t.Error("expected non-empty error message")
	}
}

// TestValidateProvider_OpenAIEmptyKey verifies that empty openai key returns valid=false.
func TestValidateProvider_OpenAIEmptyKey(t *testing.T) {
	dir := t.TempDir()

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/openai/validate", strings.NewReader(`{"api_key":""}`))
	req.SetPathValue("provider", "openai")
	rr := httptest.NewRecorder()
	s.handleValidateProvider(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var resp ProviderValidationResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Valid {
		t.Error("expected valid=false for empty key")
	}
}

// TestValidateProvider_BedrockMissingRegion verifies that missing bedrock region returns valid=false.
func TestValidateProvider_BedrockMissingRegion(t *testing.T) {
	dir := t.TempDir()

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	body := `{"region":"","access_key_id":"AKIA","secret_access_key":"secret"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/validate", strings.NewReader(body))
	req.SetPathValue("provider", "bedrock")
	rr := httptest.NewRecorder()
	s.handleValidateProvider(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var resp ProviderValidationResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Valid {
		t.Error("expected valid=false for missing region")
	}
}

// TestConfigMigration_NoMigrationWhenReposPresent verifies that if a config
// already has a populated repos array, no migration occurs and the data is
// returned as-is.
func TestConfigMigration_NoMigrationWhenReposPresent(t *testing.T) {
	dir := t.TempDir()

	modernJSON := `{"repos":[{"name":"main","path":"/home/user/project"}]}`
	configPath := filepath.Join(dir, "saw.config.json")
	if err := os.WriteFile(configPath, []byte(modernJSON), 0644); err != nil {
		t.Fatalf("failed to write modern config: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rr := httptest.NewRecorder()
	s.handleGetConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got SAWConfig
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(got.Repos) != 1 {
		t.Fatalf("expected 1 repo entry, got %d", len(got.Repos))
	}
	if got.Repos[0].Name != "main" || got.Repos[0].Path != "/home/user/project" {
		t.Errorf("unexpected repos entry: %+v", got.Repos[0])
	}
}
