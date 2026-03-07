package protocol

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// sampleDoc is a minimal IMPL doc with a Status section for use in tests.
const sampleDoc = `# IMPL: Test Feature

**Test Command:** ` + "`go test ./...`" + `

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | implement foo | TO-DO |
| 1 | B | implement bar | TO-DO |
| 1 | C | implement baz | TO-DO |
| 2 | D | wire everything | TO-DO |
`

// docWithDone has one row already DONE and one TO-DO.
const docWithDone = `# IMPL: Test Feature

**Test Command:** ` + "`go test ./...`" + `

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | implement foo | DONE  |
| 1 | B | implement bar | TO-DO |
`

// docNoStatus has no ### Status section.
const docNoStatus = `# IMPL: Test Feature

**Test Command:** ` + "`go test ./...`" + `

---

### Gap Analysis

Some gap content here.

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | implement foo | TO-DO |
`

func TestUpdateIMPLStatusBytes_SingleAgent(t *testing.T) {
	result := UpdateIMPLStatusBytes([]byte(sampleDoc), []string{"A"})
	out := string(result)

	// Row A should be DONE.
	if !strings.Contains(out, "| A | implement foo | DONE  |") {
		t.Errorf("expected row A to be DONE; got:\n%s", out)
	}
	// Rows B, C, D should still be TO-DO.
	if !strings.Contains(out, "| B | implement bar | TO-DO |") {
		t.Errorf("expected row B to remain TO-DO; got:\n%s", out)
	}
	if !strings.Contains(out, "| C | implement baz | TO-DO |") {
		t.Errorf("expected row C to remain TO-DO; got:\n%s", out)
	}
	if !strings.Contains(out, "| D | wire everything | TO-DO |") {
		t.Errorf("expected row D to remain TO-DO; got:\n%s", out)
	}
}

func TestUpdateIMPLStatusBytes_MultipleAgents(t *testing.T) {
	result := UpdateIMPLStatusBytes([]byte(sampleDoc), []string{"A", "C"})
	out := string(result)

	// Rows A and C should be DONE.
	if !strings.Contains(out, "| A | implement foo | DONE  |") {
		t.Errorf("expected row A to be DONE; got:\n%s", out)
	}
	if !strings.Contains(out, "| C | implement baz | DONE  |") {
		t.Errorf("expected row C to be DONE; got:\n%s", out)
	}
	// Rows B and D should remain TO-DO.
	if !strings.Contains(out, "| B | implement bar | TO-DO |") {
		t.Errorf("expected row B to remain TO-DO; got:\n%s", out)
	}
	if !strings.Contains(out, "| D | wire everything | TO-DO |") {
		t.Errorf("expected row D to remain TO-DO; got:\n%s", out)
	}
}

func TestUpdateIMPLStatusBytes_Idempotent(t *testing.T) {
	agents := []string{"A", "B"}

	first := UpdateIMPLStatusBytes([]byte(sampleDoc), agents)
	second := UpdateIMPLStatusBytes(first, agents)

	if string(first) != string(second) {
		t.Errorf("expected idempotent output; first pass differs from second pass.\nFirst:\n%s\nSecond:\n%s",
			string(first), string(second))
	}
}

func TestUpdateIMPLStatusBytes_NoStatusSection(t *testing.T) {
	// The table in docNoStatus is NOT under a ### Status header,
	// so it should be left completely unchanged.
	result := UpdateIMPLStatusBytes([]byte(docNoStatus), []string{"A"})

	if string(result) != docNoStatus {
		t.Errorf("expected doc with no ### Status section to be returned unchanged.\nGot:\n%s", string(result))
	}
}

func TestUpdateIMPLStatusBytes_AlreadyDone(t *testing.T) {
	// Row A is already DONE; row B is TO-DO.
	result := UpdateIMPLStatusBytes([]byte(docWithDone), []string{"A", "B"})
	out := string(result)

	// Row A must still show DONE (not double-modified).
	if !strings.Contains(out, "| A | implement foo | DONE  |") {
		t.Errorf("expected row A to remain DONE; got:\n%s", out)
	}
	// Row B should now be DONE.
	if !strings.Contains(out, "| B | implement bar | DONE  |") {
		t.Errorf("expected row B to be DONE; got:\n%s", out)
	}
	// "TO-DO" should not appear anywhere for row A (no duplication).
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "| A |") && strings.Contains(line, "TO-DO") {
			t.Errorf("row A still contains TO-DO after update: %q", line)
		}
	}
}

func TestUpdateIMPLStatus_RoundTrip(t *testing.T) {
	// Write a temp file, call UpdateIMPLStatus, read back, verify ticks.
	dir := t.TempDir()
	path := filepath.Join(dir, "IMPL-test.md")

	if err := os.WriteFile(path, []byte(sampleDoc), 0644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}

	if err := UpdateIMPLStatus(path, []string{"B", "D"}); err != nil {
		t.Fatalf("UpdateIMPLStatus returned error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read temp file after update: %v", err)
	}
	out := string(data)

	// Rows B and D should be DONE.
	if !strings.Contains(out, "| B | implement bar | DONE  |") {
		t.Errorf("expected row B to be DONE; got:\n%s", out)
	}
	if !strings.Contains(out, "| D | wire everything | DONE  |") {
		t.Errorf("expected row D to be DONE; got:\n%s", out)
	}
	// Rows A and C should remain TO-DO.
	if !strings.Contains(out, "| A | implement foo | TO-DO |") {
		t.Errorf("expected row A to remain TO-DO; got:\n%s", out)
	}
	if !strings.Contains(out, "| C | implement baz | TO-DO |") {
		t.Errorf("expected row C to remain TO-DO; got:\n%s", out)
	}
}
