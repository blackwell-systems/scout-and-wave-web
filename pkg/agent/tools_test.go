package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadFileTool(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()

	// Write a file to read back.
	content := "hello from read_file tool"
	filePath := filepath.Join(workDir, "test.txt")
	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		t.Fatalf("setup: write file: %v", err)
	}

	tool := readFileTool(workDir)
	result, err := tool.Execute(map[string]interface{}{"path": "test.txt"}, workDir)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result != content {
		t.Errorf("result = %q; want %q", result, content)
	}
}

func TestReadFileTool_MissingFile(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()

	tool := readFileTool(workDir)
	result, err := tool.Execute(map[string]interface{}{"path": "nonexistent.txt"}, workDir)
	if err != nil {
		t.Fatalf("Execute returned unexpected error: %v", err)
	}
	// Missing file should return an error string, not a Go error.
	if !strings.Contains(result, "error") {
		t.Errorf("expected error string in result for missing file, got: %q", result)
	}
}

func TestWriteFileTool(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()

	content := "written by write_file tool"
	tool := writeFileTool(workDir)
	result, err := tool.Execute(map[string]interface{}{
		"path":    "subdir/out.txt",
		"content": content,
	}, workDir)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result != "ok" {
		t.Errorf("result = %q; want %q", result, "ok")
	}

	// Verify the file was actually written.
	data, readErr := os.ReadFile(filepath.Join(workDir, "subdir", "out.txt"))
	if readErr != nil {
		t.Fatalf("ReadFile after write: %v", readErr)
	}
	if string(data) != content {
		t.Errorf("file content = %q; want %q", string(data), content)
	}
}

func TestListDirectoryTool(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()

	// Create two files.
	for _, name := range []string{"alpha.txt", "beta.txt"} {
		if err := os.WriteFile(filepath.Join(workDir, name), []byte("x"), 0o644); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}

	tool := listDirectoryTool(workDir)
	result, err := tool.Execute(map[string]interface{}{"path": "."}, workDir)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if !strings.Contains(result, "alpha.txt") {
		t.Errorf("result does not contain alpha.txt: %q", result)
	}
	if !strings.Contains(result, "beta.txt") {
		t.Errorf("result does not contain beta.txt: %q", result)
	}
}

func TestListDirectoryTool_EmptyPath(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()

	if err := os.WriteFile(filepath.Join(workDir, "file.go"), []byte("package x"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	tool := listDirectoryTool(workDir)
	// Empty path should default to ".".
	result, err := tool.Execute(map[string]interface{}{}, workDir)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if !strings.Contains(result, "file.go") {
		t.Errorf("result does not contain file.go: %q", result)
	}
}

func TestBashTool_RunsCommand(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()

	tool := bashTool(workDir)
	result, err := tool.Execute(map[string]interface{}{"command": "echo hello"}, workDir)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if !strings.Contains(result, "hello") {
		t.Errorf("result = %q; want it to contain 'hello'", result)
	}
}

func TestBashTool_PathTraversalBlocked(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()

	tool := readFileTool(workDir)
	// Attempt path traversal.
	result, err := tool.Execute(map[string]interface{}{"path": "../../etc/passwd"}, workDir)

	// Either an error is returned, or the result string contains a denial message.
	if err != nil {
		// Acceptable: Execute returned a Go error for traversal.
		if !strings.Contains(err.Error(), "path traversal denied") {
			t.Errorf("error = %q; want 'path traversal denied'", err.Error())
		}
		return
	}
	// If no error, the result must NOT contain passwd file content (it should be
	// an error message or empty).
	if strings.Contains(result, "root:") {
		t.Errorf("path traversal was not blocked; got passwd content: %q", result)
	}
}
