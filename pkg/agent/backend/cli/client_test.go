package cli

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
)

// compile-time assertion: *Client implements backend.Backend.
var _ backend.Backend = (*Client)(nil)

// TestNew_EmptyClaudePath_UsesLookPath verifies that when claudePath is empty,
// Run attempts to locate claude via PATH (and returns a meaningful error when
// claude is not installed, rather than panicking).
func TestNew_EmptyClaudePath_UsesLookPath(t *testing.T) {
	c := New("", backend.Config{})
	if c.claudePath != "" {
		t.Errorf("expected empty claudePath, got %q", c.claudePath)
	}

	// If claude is not in PATH, Run should return a descriptive error.
	_, pathErr := exec.LookPath("claude")
	if pathErr != nil {
		ctx := context.Background()
		_, err := c.Run(ctx, "", "hello", t.TempDir())
		if err == nil {
			t.Fatal("expected error when claude is not in PATH, got nil")
		}
		if !strings.Contains(err.Error(), "claude binary not found in PATH") {
			t.Errorf("expected PATH lookup error message, got: %v", err)
		}
	}
}

// TestNew_ExplicitPath verifies that an explicit claudePath is stored.
func TestNew_ExplicitPath(t *testing.T) {
	c := New("/usr/local/bin/claude", backend.Config{MaxTurns: 10})
	if c.claudePath != "/usr/local/bin/claude" {
		t.Errorf("expected claudePath=%q, got %q", "/usr/local/bin/claude", c.claudePath)
	}
	if c.cfg.MaxTurns != 10 {
		t.Errorf("expected MaxTurns=10, got %d", c.cfg.MaxTurns)
	}
}

// writeFakeScript writes a small shell script to dir/name and makes it executable.
// The script content is the provided body (without the shebang line).
func writeFakeScript(t *testing.T, dir, name, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	content := "#!/bin/sh\n" + body
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("failed to write fake script: %v", err)
	}
	return path
}

// TestRun_Success verifies that output from the fake claude script is returned.
func TestRun_Success(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := writeFakeScript(t, tmpDir, "claude", `echo "test output"
exit 0
`)

	c := New(scriptPath, backend.Config{})
	ctx := context.Background()
	out, err := c.Run(ctx, "system prompt", "user message", tmpDir)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if !strings.Contains(out, "test output") {
		t.Errorf("expected output to contain %q, got: %q", "test output", out)
	}
}

// TestRun_EchoesArguments verifies that --print, --cwd, --allowedTools,
// --dangerously-skip-permissions, and -p flags are all passed to the binary.
func TestRun_EchoesArguments(t *testing.T) {
	tmpDir := t.TempDir()
	// This script echoes all its arguments to stdout.
	scriptPath := writeFakeScript(t, tmpDir, "claude", `echo "$@"
exit 0
`)

	c := New(scriptPath, backend.Config{MaxTurns: 5})
	ctx := context.Background()
	out, err := c.Run(ctx, "sys", "usr", tmpDir)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	for _, want := range []string{"--print", "--cwd", "--allowedTools", "--dangerously-skip-permissions", "-p", "--max-turns"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected argument %q in output, got: %q", want, out)
		}
	}
}

// TestRun_MaxTurnsNotPassedWhenZero verifies --max-turns is omitted when MaxTurns == 0.
func TestRun_MaxTurnsNotPassedWhenZero(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := writeFakeScript(t, tmpDir, "claude", `echo "$@"
exit 0
`)

	c := New(scriptPath, backend.Config{MaxTurns: 0})
	ctx := context.Background()
	out, err := c.Run(ctx, "sys", "usr", tmpDir)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if strings.Contains(out, "--max-turns") {
		t.Errorf("expected --max-turns to be absent when MaxTurns==0, got: %q", out)
	}
}

// TestRun_NonZeroExit verifies that a non-zero exit code produces an error
// containing the exit code.
func TestRun_NonZeroExit(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := writeFakeScript(t, tmpDir, "claude", `echo "some error" >&2
exit 1
`)

	c := New(scriptPath, backend.Config{})
	ctx := context.Background()
	_, err := c.Run(ctx, "", "hello", tmpDir)
	if err == nil {
		t.Fatal("expected error from non-zero exit code, got nil")
	}
	if !strings.Contains(err.Error(), "1") {
		t.Errorf("expected exit code 1 in error message, got: %v", err)
	}
}

// TestRun_ContextCancellation verifies that cancelling the context causes
// Run to return an error related to context cancellation.
func TestRun_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	// Script that sleeps for a long time — context will cancel it.
	scriptPath := writeFakeScript(t, tmpDir, "claude", `sleep 60
exit 0
`)

	c := New(scriptPath, backend.Config{})
	ctx, cancel := context.WithCancel(context.Background())
	// Cancel immediately.
	cancel()

	_, err := c.Run(ctx, "", "hello", tmpDir)
	if err == nil {
		t.Fatal("expected error from context cancellation, got nil")
	}
	// The error should mention context cancellation.
	if !strings.Contains(err.Error(), "cancel") && !strings.Contains(err.Error(), "context") && !strings.Contains(err.Error(), "killed") {
		t.Errorf("expected context cancellation error, got: %v", err)
	}
}

// TestRun_EmptySystemPrompt verifies that when systemPrompt is empty,
// only the userMessage is passed to -p (no leading "\n\n").
func TestRun_EmptySystemPrompt(t *testing.T) {
	tmpDir := t.TempDir()
	// Script echoes the value of the -p argument.
	scriptPath := writeFakeScript(t, tmpDir, "claude", `echo "$@"
exit 0
`)

	c := New(scriptPath, backend.Config{})
	ctx := context.Background()
	out, err := c.Run(ctx, "", "only user message", tmpDir)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if strings.Contains(out, "\n\n") {
		t.Errorf("expected no double-newline separator when systemPrompt is empty, got: %q", out)
	}
}

// TestRunStreaming_CallsOnChunkPerLine verifies that RunStreaming calls onChunk
// once per output line and that the accumulated result matches all chunks joined.
func TestRunStreaming_CallsOnChunkPerLine(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := writeFakeScript(t, tmpDir, "claude", `printf "line one\nline two\nline three\n"
exit 0
`)

	c := New(scriptPath, backend.Config{})
	ctx := context.Background()

	var chunks []string
	out, err := c.RunStreaming(ctx, "system", "user", tmpDir, func(chunk string) {
		chunks = append(chunks, chunk)
	})
	if err != nil {
		t.Fatalf("RunStreaming returned error: %v", err)
	}

	// onChunk should be called once per line (3 lines).
	if len(chunks) != 3 {
		t.Errorf("expected 3 onChunk calls, got %d: %v", len(chunks), chunks)
	}

	// Each chunk should end with "\n".
	for i, ch := range chunks {
		if !strings.HasSuffix(ch, "\n") {
			t.Errorf("chunk[%d] = %q; expected trailing newline", i, ch)
		}
	}

	// The full output should equal all chunks concatenated.
	joined := strings.Join(chunks, "")
	if out != joined {
		t.Errorf("RunStreaming output %q != joined chunks %q", out, joined)
	}
}

// TestRunStreaming_NilCallback verifies that RunStreaming with nil onChunk
// behaves identically to Run.
func TestRunStreaming_NilCallback(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := writeFakeScript(t, tmpDir, "claude", `echo "nil callback test"
exit 0
`)

	c := New(scriptPath, backend.Config{})
	ctx := context.Background()

	outRun, errRun := c.Run(ctx, "sys", "usr", tmpDir)
	outStream, errStream := c.RunStreaming(ctx, "sys", "usr", tmpDir, nil)

	if errRun != nil || errStream != nil {
		t.Fatalf("unexpected errors: Run=%v RunStreaming=%v", errRun, errStream)
	}
	if outRun != outStream {
		t.Errorf("Run=%q RunStreaming(nil)=%q; expected equal", outRun, outStream)
	}
}
