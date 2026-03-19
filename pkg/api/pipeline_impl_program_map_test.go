package api

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeProgramManifest writes a PROGRAM manifest YAML file to docs/PROGRAM-{slug}.yaml
// under the given docsDir.
func writeProgramManifest(t *testing.T, docsDir, slug string, content string) {
	t.Helper()
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatalf("writeProgramManifest: MkdirAll: %v", err)
	}
	path := filepath.Join(docsDir, "PROGRAM-"+slug+".yaml")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("writeProgramManifest: WriteFile: %v", err)
	}
}

// TestBuildImplProgramMap_Empty verifies that when there is no docs/ directory
// the function returns a non-nil empty map without error.
func TestBuildImplProgramMap_Empty(t *testing.T) {
	dir := t.TempDir() // no docs/ subdir created
	repos := []RepoEntry{{Name: "repo", Path: dir}}

	result := buildImplProgramMapFresh(repos)
	if result == nil {
		t.Fatal("expected non-nil map")
	}
	if len(result) != 0 {
		t.Errorf("expected empty map, got %d entries", len(result))
	}
}

// TestBuildImplProgramMap_DuplicateSlug verifies first-write-wins semantics
// when the same IMPL slug appears in two PROGRAM manifests, and that a warning
// is logged naming the duplicate slug.
func TestBuildImplProgramMap_DuplicateSlug(t *testing.T) {
	dir := t.TempDir()
	docsDir := filepath.Join(dir, "docs")

	manifest1 := `title: Program One
program_slug: prog-one
state: PLANNING
impls:
  - slug: shared-impl
    title: Shared Impl
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - shared-impl
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
`
	manifest2 := `title: Program Two
program_slug: prog-two
state: PLANNING
impls:
  - slug: shared-impl
    title: Shared Impl Duplicate
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - shared-impl
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
`
	writeProgramManifest(t, docsDir, "prog-one", manifest1)
	writeProgramManifest(t, docsDir, "prog-two", manifest2)

	// Capture log output to detect warning.
	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)

	repos := []RepoEntry{{Name: "repo", Path: dir}}
	result := buildImplProgramMapFresh(repos)

	// Slug appears exactly once.
	if len(result) != 1 {
		t.Errorf("expected 1 entry, got %d", len(result))
	}

	// First-write-wins: programSlug is prog-one (filesystem iteration order is
	// lexicographic, so PROGRAM-prog-one.yaml comes before PROGRAM-prog-two.yaml).
	entry, ok := result["shared-impl"]
	if !ok {
		t.Fatal("expected 'shared-impl' in result map")
	}
	if entry.programSlug != "prog-one" {
		t.Errorf("expected first-write-wins programSlug=prog-one, got %q", entry.programSlug)
	}

	// Warning should mention the duplicate slug.
	logOutput := logBuf.String()
	if !strings.Contains(logOutput, "shared-impl") {
		t.Errorf("expected log warning mentioning 'shared-impl', got: %q", logOutput)
	}
}

// TestBuildImplProgramMap_ParseError verifies that a malformed PROGRAM manifest
// is skipped and the function continues processing remaining valid manifests.
func TestBuildImplProgramMap_ParseError(t *testing.T) {
	dir := t.TempDir()
	docsDir := filepath.Join(dir, "docs")

	validManifest := `title: Valid Program
program_slug: valid-prog
state: PLANNING
impls:
  - slug: valid-impl
    title: Valid Impl
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - valid-impl
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
`
	invalidManifest := `{this is not valid yaml: [}`

	writeProgramManifest(t, docsDir, "valid-prog", validManifest)
	writeProgramManifest(t, docsDir, "invalid-prog", invalidManifest)

	repos := []RepoEntry{{Name: "repo", Path: dir}}
	result := buildImplProgramMapFresh(repos)

	// Should not panic; valid manifest should be present.
	if _, ok := result["valid-impl"]; !ok {
		t.Error("expected 'valid-impl' from the valid manifest to appear in result")
	}
}

// TestBuildImplProgramMap_MissingDocsDir verifies that a RepoEntry pointing to
// a non-existent path returns an empty map without panicking.
func TestBuildImplProgramMap_MissingDocsDir(t *testing.T) {
	repos := []RepoEntry{{Name: "repo", Path: "/nonexistent/path/that/does/not/exist"}}

	result := buildImplProgramMapFresh(repos)
	if result == nil {
		t.Fatal("expected non-nil map")
	}
	if len(result) != 0 {
		t.Errorf("expected empty map for missing repo, got %d entries", len(result))
	}
}

// TestBuildImplProgramMap_TierContext verifies that the programTier and
// programTiersTotal fields are populated correctly from the manifest.
func TestBuildImplProgramMap_TierContext(t *testing.T) {
	dir := t.TempDir()
	docsDir := filepath.Join(dir, "docs")

	manifest := `title: Tiered Program
program_slug: tiered-prog
state: PLANNING
impls:
  - slug: tier1-impl
    title: Tier 1 Impl
    tier: 1
    status: pending
  - slug: tier2-impl
    title: Tier 2 Impl
    tier: 2
    status: pending
  - slug: tier3-impl
    title: Tier 3 Impl
    tier: 3
    status: pending
tiers:
  - number: 1
    impls:
      - tier1-impl
  - number: 2
    impls:
      - tier2-impl
  - number: 3
    impls:
      - tier3-impl
completion:
  tiers_complete: 0
  tiers_total: 3
  impls_complete: 0
  impls_total: 3
`
	writeProgramManifest(t, docsDir, "tiered-prog", manifest)

	repos := []RepoEntry{{Name: "repo", Path: dir}}
	result := buildImplProgramMapFresh(repos)

	entry, ok := result["tier2-impl"]
	if !ok {
		t.Fatal("expected 'tier2-impl' in result")
	}
	if entry.programTier != 2 {
		t.Errorf("expected programTier=2, got %d", entry.programTier)
	}
	if entry.programTiersTotal != 3 {
		t.Errorf("expected programTiersTotal=3, got %d", entry.programTiersTotal)
	}
}

// TestBuildImplProgramMap_MultiRepo verifies that IMPLs from two separate repos
// both appear in the result map.
func TestBuildImplProgramMap_MultiRepo(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()

	manifestA := `title: Program A
program_slug: prog-a
state: PLANNING
impls:
  - slug: impl-from-a
    title: Impl From A
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - impl-from-a
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
`
	manifestB := `title: Program B
program_slug: prog-b
state: PLANNING
impls:
  - slug: impl-from-b
    title: Impl From B
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - impl-from-b
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
`
	writeProgramManifest(t, filepath.Join(dirA, "docs"), "prog-a", manifestA)
	writeProgramManifest(t, filepath.Join(dirB, "docs"), "prog-b", manifestB)

	repos := []RepoEntry{
		{Name: "repo-a", Path: dirA},
		{Name: "repo-b", Path: dirB},
	}
	result := buildImplProgramMapFresh(repos)

	if _, ok := result["impl-from-a"]; !ok {
		t.Error("expected 'impl-from-a' from repo-a in result")
	}
	if _, ok := result["impl-from-b"]; !ok {
		t.Error("expected 'impl-from-b' from repo-b in result")
	}
}
