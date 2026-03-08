package agent

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/worktree"
)

// mockBackend is a test double for the backend.Backend interface.
type mockBackend struct {
	mu              sync.Mutex
	lastSystem      string
	lastUser        string
	lastWorkDir     string
	responseToSend  string
	errToReturn     error
}

func (m *mockBackend) Run(_ context.Context, systemPrompt, userMessage, workDir string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastSystem = systemPrompt
	m.lastUser = userMessage
	m.lastWorkDir = workDir
	return m.responseToSend, m.errToReturn
}

func (m *mockBackend) RunStreaming(ctx context.Context, systemPrompt, userMessage, workDir string, onChunk backend.ChunkCallback) (string, error) {
	return m.Run(ctx, systemPrompt, userMessage, workDir)
}

// compile-time assertion: *mockBackend implements backend.Backend.
var _ backend.Backend = (*mockBackend)(nil)

// TestNewRunner verifies that NewRunner returns a non-nil Runner correctly
// wired with the provided Backend and Manager.
func TestNewRunner(t *testing.T) {
	t.Parallel()

	b := &mockBackend{responseToSend: "ok"}
	mgr := worktree.New(t.TempDir())

	r := NewRunner(b, mgr)
	if r == nil {
		t.Fatal("NewRunner returned nil")
	}
	if r.client != b {
		t.Error("Runner.client does not reference the provided Backend")
	}
	if r.worktrees != mgr {
		t.Error("Runner.worktrees does not reference the provided Manager")
	}
}

// TestExecute_CallsBackendRun verifies that Execute passes the agent prompt as
// the system prompt and builds the expected user message containing worktreePath.
func TestExecute_CallsBackendRun(t *testing.T) {
	t.Parallel()

	const worktreePath = "/some/repo/.claude/worktrees/wave1-agent-A"
	const agentPrompt = "You are a Wave agent. Do the thing."

	b := &mockBackend{responseToSend: "done"}
	r := NewRunner(b, worktree.New(t.TempDir()))

	spec := &types.AgentSpec{
		Letter: "A",
		Prompt: agentPrompt,
	}

	resp, err := r.Execute(context.Background(), spec, worktreePath)
	if err != nil {
		t.Fatalf("Execute returned unexpected error: %v", err)
	}
	if resp != "done" {
		t.Errorf("Execute returned %q; want %q", resp, "done")
	}

	// System prompt must equal the agent spec's prompt verbatim.
	if b.lastSystem != agentPrompt {
		t.Errorf("system prompt = %q; want %q", b.lastSystem, agentPrompt)
	}

	// User message must contain the worktree path twice (once as path, once in
	// the cd command).
	if !strings.Contains(b.lastUser, worktreePath) {
		t.Errorf("user message does not contain worktreePath %q:\n%s", worktreePath, b.lastUser)
	}
	count := strings.Count(b.lastUser, worktreePath)
	if count < 2 {
		t.Errorf("user message contains worktreePath %d time(s); want at least 2:\n%s", count, b.lastUser)
	}

	// workDir passed to backend must equal the worktree path.
	if b.lastWorkDir != worktreePath {
		t.Errorf("workDir passed to backend = %q; want %q", b.lastWorkDir, worktreePath)
	}
}

// TestExecute_BackendError verifies that backend errors are returned
// immediately without retry.
func TestExecute_BackendError(t *testing.T) {
	t.Parallel()

	apiErr := fmt.Errorf("upstream API failure")
	b := &mockBackend{errToReturn: apiErr}
	r := NewRunner(b, worktree.New(t.TempDir()))

	spec := &types.AgentSpec{Letter: "B", Prompt: "do something"}
	_, err := r.Execute(context.Background(), spec, "/tmp/wt")
	if err == nil {
		t.Fatal("Execute did not propagate backend error")
	}
	if !strings.Contains(err.Error(), "upstream API failure") {
		t.Errorf("error %q does not contain original message", err.Error())
	}
}

// implDocWithReport writes a minimal IMPL markdown file that contains a
// completion report block for agentLetter with status "complete".
func implDocWithReport(t *testing.T, dir, agentLetter string) string {
	t.Helper()
	content := fmt.Sprintf(`# IMPL: Test Feature

## Wave 1

### Agent %s: Do something

Agent prompt here.

### Agent %s - Completion Report

`+"```yaml"+`
status: complete
worktree: .claude/worktrees/wave1-agent-%s
branch: wave1-agent-%s
commit: abc1234
files_changed: []
files_created:
  - pkg/foo/bar.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestFoo
verification: PASS
`+"```"+`
`,
		agentLetter, agentLetter,
		strings.ToLower(agentLetter), strings.ToLower(agentLetter),
	)

	path := filepath.Join(dir, "IMPL-test.md")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test IMPL doc: %v", err)
	}
	return path
}

// TestRunner_ParseCompletionReport_Found verifies that ParseCompletionReport
// returns a report when the section exists in the IMPL doc.
func TestRunner_ParseCompletionReport_Found(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	implPath := implDocWithReport(t, dir, "A")
	r := NewRunner(&mockBackend{}, worktree.New(dir))
	report, err := r.ParseCompletionReport(implPath, "A")
	if err != nil {
		t.Fatalf("ParseCompletionReport returned error: %v", err)
	}
	if report.Status != types.StatusComplete {
		t.Errorf("status = %q, want complete", report.Status)
	}
}

// TestRunner_ParseCompletionReport_NotFound verifies ErrReportNotFound is
// returned when the agent section is absent.
func TestRunner_ParseCompletionReport_NotFound(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	implPath := implDocWithReport(t, dir, "A")
	r := NewRunner(&mockBackend{}, worktree.New(dir))
	_, err := r.ParseCompletionReport(implPath, "Z")
	if err == nil {
		t.Fatal("expected error for missing agent Z, got nil")
	}
}

// TestWaitForCompletion_FoundImmediately verifies that WaitForCompletion
// returns successfully on the very first poll when a report is already present.
func TestWaitForCompletion_FoundImmediately(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	implPath := implDocWithReport(t, dir, "A")

	report, err := WaitForCompletion(implPath, "A", 5*time.Second, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("WaitForCompletion returned error: %v", err)
	}
	if report == nil {
		t.Fatal("WaitForCompletion returned nil report")
	}
	if report.Status != types.StatusComplete {
		t.Errorf("report.Status = %q; want %q", report.Status, types.StatusComplete)
	}
}

// TestWaitForCompletion_Timeout verifies that WaitForCompletion returns a
// timeout error when the IMPL doc never contains the requested report.
func TestWaitForCompletion_Timeout(t *testing.T) {
	t.Parallel()

	// Use a path that doesn't exist at all so ParseCompletionReport always
	// returns ErrReportNotFound (via a file-open error wrapped differently).
	// Instead, use a real empty IMPL doc with no completion section.
	dir := t.TempDir()
	implPath := filepath.Join(dir, "IMPL-empty.md")
	if err := os.WriteFile(implPath, []byte("# IMPL: Nothing\n"), 0o644); err != nil {
		t.Fatalf("failed to create empty IMPL doc: %v", err)
	}

	start := time.Now()
	_, err := WaitForCompletion(implPath, "Z", 200*time.Millisecond, 50*time.Millisecond)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("WaitForCompletion should have returned a timeout error")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("expected timeout error, got: %v", err)
	}
	// Should have waited at least some time but not much more than timeout.
	if elapsed < 150*time.Millisecond {
		t.Errorf("returned too quickly (%v); expected ~200ms", elapsed)
	}
	if elapsed > 2*time.Second {
		t.Errorf("took too long (%v); expected ~200ms", elapsed)
	}
}

// TestWaitForCompletion_RetryOnNotFound verifies that WaitForCompletion polls
// multiple times and eventually succeeds once the report is written to disk.
func TestWaitForCompletion_RetryOnNotFound(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	implPath := filepath.Join(dir, "IMPL-delayed.md")

	// Start with an IMPL doc that has no completion report.
	initial := "# IMPL: Delayed Feature\n\n## Wave 1\n\n### Agent C: Do stuff\n\nPrompt here.\n"
	if err := os.WriteFile(implPath, []byte(initial), 0o644); err != nil {
		t.Fatalf("failed to write initial IMPL doc: %v", err)
	}

	// After a short delay, overwrite the file with a report present.
	go func() {
		time.Sleep(150 * time.Millisecond)
		// Build the full doc with completion report appended.
		withReport := initial + fmt.Sprintf(`
### Agent C - Completion Report

`+"```yaml"+`
status: complete
worktree: .claude/worktrees/wave1-agent-c
branch: wave1-agent-c
commit: deadbeef
files_changed: []
files_created:
  - pkg/something/thing.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestSomething
verification: PASS
`+"```"+`
`)
		_ = os.WriteFile(implPath, []byte(withReport), 0o644)
	}()

	report, err := WaitForCompletion(implPath, "C", 5*time.Second, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("WaitForCompletion returned error: %v", err)
	}
	if report == nil {
		t.Fatal("WaitForCompletion returned nil report")
	}
	if report.Status != types.StatusComplete {
		t.Errorf("report.Status = %q; want %q", report.Status, types.StatusComplete)
	}
}
