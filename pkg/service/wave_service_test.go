package service

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// waveTestPublisher is a test double for EventPublisher that records published events.
type waveTestPublisher struct {
	mu     sync.Mutex
	events []Event
}

func (m *waveTestPublisher) Publish(channel string, event Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
}

func (m *waveTestPublisher) Subscribe(channel string) (<-chan Event, func()) {
	ch := make(chan Event, 10)
	return ch, func() { close(ch) }
}

func (m *waveTestPublisher) getEvents() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]Event, len(m.events))
	copy(cp, m.events)
	return cp
}

func TestStartWave_AlreadyRunning(t *testing.T) {
	slug := "test-already-running"

	// Simulate an already-active wave by pre-storing the slug.
	ActiveWaves.Store(slug, struct{}{})
	defer ActiveWaves.Delete(slug)

	pub := &waveTestPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		IMPLDir:   "/tmp/nonexistent/docs/IMPL",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := StartWave(deps, slug)
	if err == nil {
		t.Fatal("expected error for already-running slug, got nil")
	}
	if got := err.Error(); got != `wave already running for slug "test-already-running"` {
		t.Fatalf("unexpected error message: %s", got)
	}
}

func TestProceedGate_UnblocksChannel(t *testing.T) {
	slug := "test-proceed-gate"

	// Create a buffered gate channel and register it.
	gateCh := make(chan bool, 1)
	gateChannels.Store(slug, gateCh)
	defer gateChannels.Delete(slug)

	pub := &waveTestPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := ProceedGate(deps, slug)
	if err != nil {
		t.Fatalf("ProceedGate returned error: %v", err)
	}

	// Verify the channel received a signal.
	select {
	case val := <-gateCh:
		if !val {
			t.Fatal("expected true on gate channel, got false")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("gate channel did not receive signal within timeout")
	}
}

func TestProceedGate_NoGatePending(t *testing.T) {
	slug := "test-no-gate"

	pub := &waveTestPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := ProceedGate(deps, slug)
	if err == nil {
		t.Fatal("expected error for no pending gate, got nil")
	}
}

func TestStartWave_PublishesRunStarted(t *testing.T) {
	// We test makePublish directly since StartWave requires a real IMPL doc.
	slug := "test-publish"
	pub := &waveTestPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	publish := makePublish(deps, slug)
	publish("run_started", map[string]string{"slug": slug, "impl_path": "/some/path"})

	events := pub.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Name != "run_started" {
		t.Fatalf("expected event name 'run_started', got %q", events[0].Name)
	}
	if events[0].Channel != slug {
		t.Fatalf("expected channel %q, got %q", slug, events[0].Channel)
	}
}

func TestStopWave_NotRunning(t *testing.T) {
	pub := &waveTestPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := StopWave(deps, "nonexistent-slug")
	if err == nil {
		t.Fatal("expected error for non-running slug, got nil")
	}
}

func TestRerunAgent_InvalidWave(t *testing.T) {
	pub := &waveTestPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := RerunAgent(deps, "test-slug", 0, "A", "")
	if err == nil {
		t.Fatal("expected error for wave < 1, got nil")
	}
}

func TestFinalizeWave_InvalidWave(t *testing.T) {
	pub := &waveTestPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := FinalizeWave(deps, "test-slug", 0)
	if err == nil {
		t.Fatal("expected error for wave < 1, got nil")
	}
}

func TestRepoRedirect_SingleRepoDifferentFromServer(t *testing.T) {
	// Create a temporary directory structure simulating sibling repos.
	parent := t.TempDir()
	serverRepo := filepath.Join(parent, "scout-and-wave-web")
	targetRepo := filepath.Join(parent, "scout-and-wave-go")
	if err := os.MkdirAll(serverRepo, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(targetRepo, 0o755); err != nil {
		t.Fatal(err)
	}

	manifest := &protocol.IMPLManifest{
		FileOwnership: []protocol.FileOwnership{
			{File: "pkg/engine/run.go", Agent: "A", Wave: 1, Repo: "scout-and-wave-go"},
			{File: "pkg/engine/run_test.go", Agent: "A", Wave: 1, Repo: "scout-and-wave-go"},
			{File: "pkg/protocol/validate.go", Agent: "B", Wave: 1, Repo: "scout-and-wave-go"},
		},
	}

	resolvedPath, repoName, redirected := resolveTargetRepoFromManifest(manifest, serverRepo)
	if !redirected {
		t.Fatal("expected redirect to be true")
	}
	if repoName != "scout-and-wave-go" {
		t.Fatalf("expected target repo name 'scout-and-wave-go', got %q", repoName)
	}
	if resolvedPath != targetRepo {
		t.Fatalf("expected resolved path %q, got %q", targetRepo, resolvedPath)
	}
}

func TestRepoRedirect_NoRepoField_NoRedirect(t *testing.T) {
	manifest := &protocol.IMPLManifest{
		FileOwnership: []protocol.FileOwnership{
			{File: "pkg/service/wave_service.go", Agent: "A", Wave: 1},
			{File: "pkg/api/handler.go", Agent: "B", Wave: 1},
		},
	}

	resolvedPath, repoName, redirected := resolveTargetRepoFromManifest(manifest, "/some/repo/path")
	if redirected {
		t.Fatal("expected no redirect when repo fields are empty")
	}
	if repoName != "" {
		t.Fatalf("expected empty target repo name, got %q", repoName)
	}
	if resolvedPath != "/some/repo/path" {
		t.Fatalf("expected original path, got %q", resolvedPath)
	}
}

func TestRepoRedirect_SameRepo_NoRedirect(t *testing.T) {
	manifest := &protocol.IMPLManifest{
		FileOwnership: []protocol.FileOwnership{
			{File: "pkg/foo.go", Agent: "A", Wave: 1, Repo: "my-repo"},
		},
	}

	resolvedPath, repoName, redirected := resolveTargetRepoFromManifest(manifest, "/workspace/my-repo")
	if redirected {
		t.Fatal("expected no redirect when repo matches current")
	}
	if repoName != "" {
		t.Fatalf("expected empty target repo name, got %q", repoName)
	}
	if resolvedPath != "/workspace/my-repo" {
		t.Fatalf("expected original path, got %q", resolvedPath)
	}
}

func TestRepoRedirect_UnresolvableRepo(t *testing.T) {
	// Use a temp dir with no siblings matching the target repo.
	parent := t.TempDir()
	serverRepo := filepath.Join(parent, "server-repo")
	if err := os.MkdirAll(serverRepo, 0o755); err != nil {
		t.Fatal(err)
	}

	manifest := &protocol.IMPLManifest{
		FileOwnership: []protocol.FileOwnership{
			{File: "pkg/foo.go", Agent: "A", Wave: 1, Repo: "nonexistent-repo"},
		},
	}

	resolvedPath, repoName, redirected := resolveTargetRepoFromManifest(manifest, serverRepo)
	if redirected {
		t.Fatal("expected redirected to be false for unresolvable repo")
	}
	if repoName != "nonexistent-repo" {
		t.Fatalf("expected target repo name 'nonexistent-repo', got %q", repoName)
	}
	if resolvedPath != "" {
		t.Fatalf("expected empty resolved path for unresolvable repo, got %q", resolvedPath)
	}
}

func TestRepoRedirect_ConfigJsonResolution(t *testing.T) {
	parent := t.TempDir()
	serverRepo := filepath.Join(parent, "web-app")
	targetRepo := filepath.Join(parent, "custom-location", "engine")
	if err := os.MkdirAll(serverRepo, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(targetRepo, 0o755); err != nil {
		t.Fatal(err)
	}

	// Write saw.config.json with custom repo path.
	configContent := `{"repos": [{"name": "engine", "path": "` + targetRepo + `"}]}`
	if err := os.WriteFile(filepath.Join(serverRepo, "saw.config.json"), []byte(configContent), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := &protocol.IMPLManifest{
		FileOwnership: []protocol.FileOwnership{
			{File: "pkg/run.go", Agent: "A", Wave: 1, Repo: "engine"},
		},
	}

	resolvedPath, repoName, redirected := resolveTargetRepoFromManifest(manifest, serverRepo)
	if !redirected {
		t.Fatal("expected redirect via config json")
	}
	if repoName != "engine" {
		t.Fatalf("expected target repo name 'engine', got %q", repoName)
	}
	if resolvedPath != targetRepo {
		t.Fatalf("expected resolved path %q, got %q", targetRepo, resolvedPath)
	}
}

func TestTargetRepoNames(t *testing.T) {
	manifest := &protocol.IMPLManifest{
		FileOwnership: []protocol.FileOwnership{
			{File: "a.go", Agent: "A", Wave: 1, Repo: "repo-a"},
			{File: "b.go", Agent: "B", Wave: 1, Repo: "repo-b"},
			{File: "c.go", Agent: "C", Wave: 1, Repo: "repo-a"},
			{File: "d.go", Agent: "D", Wave: 1},
		},
	}

	names := targetRepoNames(manifest)
	if len(names) != 2 {
		t.Fatalf("expected 2 unique repo names, got %d: %v", len(names), names)
	}

	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}
	if !nameSet["repo-a"] || !nameSet["repo-b"] {
		t.Fatalf("expected repo-a and repo-b, got %v", names)
	}
}

func TestTargetRepoNames_Nil(t *testing.T) {
	names := targetRepoNames(nil)
	if names != nil {
		t.Fatalf("expected nil for nil manifest, got %v", names)
	}
}
