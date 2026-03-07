package cli

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
)

// Client implements backend.Backend by shelling out to the claude CLI.
type Client struct {
	claudePath string
	cfg        backend.Config
}

// New creates a CLI Client. claudePath is the path to the claude binary;
// if empty, it is located via PATH at Run time.
func New(claudePath string, cfg backend.Config) *Client {
	return &Client{
		claudePath: claudePath,
		cfg:        cfg,
	}
}

// Run implements backend.Backend.
// It invokes: claude --print --cwd workDir --allowedTools "Bash,Read,Write,Edit,Glob,Grep"
// --dangerously-skip-permissions -p "<systemPrompt>\n\n<userMessage>"
// and streams stdout line-by-line until the process exits.
func (c *Client) Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error) {
	claudePath := c.claudePath
	if claudePath == "" {
		var err error
		claudePath, err = exec.LookPath("claude")
		if err != nil {
			return "", fmt.Errorf("cli backend: claude binary not found in PATH: %w", err)
		}
	}

	// Build the combined prompt.
	var prompt string
	if systemPrompt == "" {
		prompt = userMessage
	} else {
		prompt = systemPrompt + "\n\n" + userMessage
	}

	// Build the argument list.
	args := []string{
		"--print",
		"--cwd", workDir,
		"--allowedTools", "Bash,Read,Write,Edit,Glob,Grep",
		"--dangerously-skip-permissions",
	}
	if c.cfg.MaxTurns > 0 {
		args = append(args, "--max-turns", fmt.Sprintf("%d", c.cfg.MaxTurns))
	}
	args = append(args, "-p", prompt)

	cmd := exec.CommandContext(ctx, claudePath, args...)

	// Capture stderr separately for error messages.
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("cli backend: failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("cli backend: failed to start claude: %w", err)
	}

	// Stream stdout line-by-line, accumulating all output.
	var sb strings.Builder
	scanner := bufio.NewScanner(stdoutPipe)
	for scanner.Scan() {
		sb.WriteString(scanner.Text())
		sb.WriteString("\n")
	}
	if scanErr := scanner.Err(); scanErr != nil {
		// If the context was cancelled, the scanner error is expected.
		if ctx.Err() != nil {
			_ = cmd.Wait()
			return "", fmt.Errorf("cli backend: context cancelled: %w", ctx.Err())
		}
		return "", fmt.Errorf("cli backend: error reading stdout: %w", scanErr)
	}

	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("cli backend: context cancelled: %w", ctx.Err())
		}
		stderr := strings.TrimSpace(stderrBuf.String())
		if exitErr, ok := err.(*exec.ExitError); ok {
			if stderr != "" {
				return "", fmt.Errorf("cli backend: claude exited with code %d: %s", exitErr.ExitCode(), stderr)
			}
			return "", fmt.Errorf("cli backend: claude exited with code %d", exitErr.ExitCode())
		}
		return "", fmt.Errorf("cli backend: claude failed: %w", err)
	}

	return sb.String(), nil
}
