package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// minimalIMPLForImport is a minimal IMPL YAML suitable for import tests.
const minimalIMPLForImport = `title: Import Test Feature
feature_slug: import-test
verdict: SUITABLE
test_command: go test ./...
lint_command: go vet ./...
waves:
    - number: 1
      agents:
          - id: A
            task: Do the thing
            files:
                - pkg/foo/bar.go
`

// TestHandleImportIMPLs_MissingProgramSlug verifies that omitting program_slug returns 400.
func TestHandleImportIMPLs_MissingProgramSlug(t *testing.T) {
	s, _ := makeTestServer(t)

	body := `{"impl_paths": ["/some/path/IMPL-foo.yaml"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/impl/import", bytes.NewBufferString(body))
	rr := httptest.NewRecorder()
	s.handleImportIMPLs(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleImportIMPLs_MissingImplPaths verifies that omitting impl_paths and discover:false returns 400.
func TestHandleImportIMPLs_MissingImplPaths(t *testing.T) {
	s, _ := makeTestServer(t)

	body := `{"program_slug": "test-program"}`
	req := httptest.NewRequest(http.MethodPost, "/api/impl/import", bytes.NewBufferString(body))
	rr := httptest.NewRecorder()
	s.handleImportIMPLs(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleImportIMPLs_InvalidJSON verifies that malformed JSON returns 400.
func TestHandleImportIMPLs_InvalidJSON(t *testing.T) {
	s, _ := makeTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/impl/import", bytes.NewBufferString("{bad json"))
	rr := httptest.NewRecorder()
	s.handleImportIMPLs(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleImportIMPLs_CreatesManifest verifies that a valid request creates a new
// PROGRAM manifest file, and the response lists the imported slug.
func TestHandleImportIMPLs_CreatesManifest(t *testing.T) {
	s, dir := makeTestServer(t)

	// Create a real IMPL doc so protocol.Load succeeds.
	implPath := writeIMPLDoc(t, dir, "my-feature", minimalIMPLForImport)

	req := httptest.NewRequest(http.MethodPost, "/api/impl/import", mustMarshal(t, ImportIMPLsRequest{
		ProgramSlug: "my-program",
		IMPLPaths:   []string{implPath},
		RepoDir:     dir,
	}))
	rr := httptest.NewRecorder()
	s.handleImportIMPLs(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp ImportIMPLsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Imported) != 1 || resp.Imported[0] != "my-feature" {
		t.Errorf("expected Imported=[\"my-feature\"], got %v", resp.Imported)
	}
	if len(resp.Skipped) != 0 {
		t.Errorf("expected no skipped, got %v", resp.Skipped)
	}
	if resp.ProgramPath == "" {
		t.Error("expected non-empty ProgramPath")
	}

	// Verify the manifest was written to disk.
	if _, err := os.Stat(resp.ProgramPath); err != nil {
		t.Errorf("PROGRAM manifest not written to disk at %s: %v", resp.ProgramPath, err)
	}
}

// TestHandleImportIMPLs_SkipsExistingSlug verifies that importing an already-present
// slug reports it as skipped rather than imported.
func TestHandleImportIMPLs_SkipsExistingSlug(t *testing.T) {
	s, dir := makeTestServer(t)

	implPath := writeIMPLDoc(t, dir, "existing-feat", minimalIMPLForImport)

	// First import: creates the manifest.
	req1 := httptest.NewRequest(http.MethodPost, "/api/impl/import", mustMarshal(t, ImportIMPLsRequest{
		ProgramSlug: "dup-program",
		IMPLPaths:   []string{implPath},
		RepoDir:     dir,
	}))
	rr1 := httptest.NewRecorder()
	s.handleImportIMPLs(rr1, req1)

	if rr1.Code != http.StatusOK {
		t.Fatalf("first import: expected 200, got %d: %s", rr1.Code, rr1.Body.String())
	}

	// Second import of the same path: should skip.
	req2 := httptest.NewRequest(http.MethodPost, "/api/impl/import", mustMarshal(t, ImportIMPLsRequest{
		ProgramSlug: "dup-program",
		IMPLPaths:   []string{implPath},
		RepoDir:     dir,
	}))
	rr2 := httptest.NewRecorder()
	s.handleImportIMPLs(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Fatalf("second import: expected 200, got %d: %s", rr2.Code, rr2.Body.String())
	}

	var resp ImportIMPLsResponse
	if err := json.NewDecoder(rr2.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Imported) != 0 {
		t.Errorf("expected no new imports on duplicate, got %v", resp.Imported)
	}
	if len(resp.Skipped) != 1 || resp.Skipped[0] != "existing-feat" {
		t.Errorf("expected Skipped=[\"existing-feat\"], got %v", resp.Skipped)
	}
}

// TestHandleImportIMPLs_TierMap verifies that tier assignments from TierMap are
// stored correctly in the written PROGRAM manifest.
func TestHandleImportIMPLs_TierMap(t *testing.T) {
	s, dir := makeTestServer(t)

	implPath1 := writeIMPLDoc(t, dir, "tier1-impl", minimalIMPLForImport)
	implPath2 := filepath.Join(dir, "docs", "IMPL", "IMPL-tier2-impl.yaml")
	if err := os.WriteFile(implPath2, []byte(minimalIMPLForImport), 0644); err != nil {
		t.Fatalf("writeFile: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/impl/import", mustMarshal(t, ImportIMPLsRequest{
		ProgramSlug: "tiered-program",
		IMPLPaths:   []string{implPath1, implPath2},
		TierMap:     map[string]int{"tier1-impl": 1, "tier2-impl": 2},
		RepoDir:     dir,
	}))
	rr := httptest.NewRecorder()
	s.handleImportIMPLs(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp ImportIMPLsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Load the written manifest and verify tier assignments.
	m, err := protocol.ParseProgramManifest(resp.ProgramPath)
	if err != nil {
		t.Fatalf("failed to parse written manifest: %v", err)
	}

	tierFor := make(map[string]int)
	for _, pi := range m.Impls {
		tierFor[pi.Slug] = pi.Tier
	}

	if tierFor["tier1-impl"] != 1 {
		t.Errorf("expected tier1-impl in tier 1, got %d", tierFor["tier1-impl"])
	}
	if tierFor["tier2-impl"] != 2 {
		t.Errorf("expected tier2-impl in tier 2, got %d", tierFor["tier2-impl"])
	}

	// Two distinct tiers should produce two tier entries.
	if len(m.Tiers) != 2 {
		t.Errorf("expected 2 tiers, got %d", len(m.Tiers))
	}
}

// TestHandleImportIMPLs_Discover verifies that discover:true scans the repo dir
// for IMPL docs and includes them in the import.
func TestHandleImportIMPLs_Discover(t *testing.T) {
	s, dir := makeTestServer(t)

	// Place an IMPL doc in the standard location so discoverIMPLPaths can find it.
	writeIMPLDoc(t, dir, "discovered-feature", minimalIMPLForImport)

	req := httptest.NewRequest(http.MethodPost, "/api/impl/import", mustMarshal(t, ImportIMPLsRequest{
		ProgramSlug: "discover-program",
		Discover:    true,
		RepoDir:     dir,
	}))
	rr := httptest.NewRecorder()
	s.handleImportIMPLs(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp ImportIMPLsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	found := false
	for _, slug := range resp.Imported {
		if slug == "discovered-feature" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected 'discovered-feature' in Imported, got %v", resp.Imported)
	}
}

// TestSlugFromIMPLPath verifies slugFromIMPLPath extracts slugs correctly from
// various path formats.
func TestSlugFromIMPLPath(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/repo/docs/IMPL/IMPL-my-feature.yaml", "my-feature"},
		{"/repo/docs/IMPL/complete/IMPL-done.yaml", "done"},
		{"IMPL-simple.yaml", "simple"},
		{"/path/IMPL-multi-word-slug.yaml", "multi-word-slug"},
	}

	for _, tc := range cases {
		got := slugFromIMPLPath(tc.path)
		if got != tc.want {
			t.Errorf("slugFromIMPLPath(%q) = %q, want %q", tc.path, got, tc.want)
		}
	}
}

// TestAppendUnique verifies appendUnique deduplicates values across dst and src.
func TestAppendUnique(t *testing.T) {
	dst := []string{"a", "b"}
	src := []string{"b", "c", "d"}
	result := appendUnique(dst, src)

	want := []string{"a", "b", "c", "d"}
	if len(result) != len(want) {
		t.Fatalf("expected %v, got %v", want, result)
	}
	for i, v := range want {
		if result[i] != v {
			t.Errorf("result[%d] = %q, want %q", i, result[i], v)
		}
	}
}

// TestBuildTiers verifies that buildTiers groups impls by tier and returns
// a sorted slice of ProgramTier.
func TestBuildTiers(t *testing.T) {
	impls := []protocol.ProgramIMPL{
		{Slug: "impl-b", Tier: 2},
		{Slug: "impl-a", Tier: 1},
		{Slug: "impl-c", Tier: 2},
	}

	tiers := buildTiers(impls)

	if len(tiers) != 2 {
		t.Fatalf("expected 2 tiers, got %d", len(tiers))
	}

	if tiers[0].Number != 1 {
		t.Errorf("tiers[0].Number = %d, want 1", tiers[0].Number)
	}
	if len(tiers[0].Impls) != 1 || tiers[0].Impls[0] != "impl-a" {
		t.Errorf("tiers[0].Impls = %v, want [impl-a]", tiers[0].Impls)
	}

	if tiers[1].Number != 2 {
		t.Errorf("tiers[1].Number = %d, want 2", tiers[1].Number)
	}
	if len(tiers[1].Impls) != 2 {
		t.Errorf("tiers[1] should have 2 impls, got %v", tiers[1].Impls)
	}
}

// TestBuildCompletion verifies that buildCompletion counts complete impls correctly.
func TestBuildCompletion(t *testing.T) {
	impls := []protocol.ProgramIMPL{
		{Slug: "a", Tier: 1, Status: "complete", EstimatedAgents: 2, EstimatedWaves: 1},
		{Slug: "b", Tier: 1, Status: "pending", EstimatedAgents: 3, EstimatedWaves: 2},
	}

	c := buildCompletion(impls)

	if c.ImplsTotal != 2 {
		t.Errorf("ImplsTotal = %d, want 2", c.ImplsTotal)
	}
	if c.ImplsComplete != 1 {
		t.Errorf("ImplsComplete = %d, want 1", c.ImplsComplete)
	}
	if c.TiersTotal != 1 {
		t.Errorf("TiersTotal = %d, want 1 (both in tier 1)", c.TiersTotal)
	}
	if c.TotalAgents != 5 {
		t.Errorf("TotalAgents = %d, want 5", c.TotalAgents)
	}
	if c.TotalWaves != 3 {
		t.Errorf("TotalWaves = %d, want 3", c.TotalWaves)
	}
}

// TestSaveProgramManifest_RoundTrip verifies that saveProgramManifest writes
// a PROGRAM manifest that can be re-read by protocol.ParseProgramManifest.
func TestSaveProgramManifest_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "PROGRAM-test.yaml")

	orig := &protocol.PROGRAMManifest{
		ProgramSlug: "test-prog",
		Title:       "Test Program",
		State:       protocol.ProgramStatePlanning,
		Impls: []protocol.ProgramIMPL{
			{Slug: "feat-a", Tier: 1, Status: "pending"},
		},
		Tiers: []protocol.ProgramTier{
			{Number: 1, Impls: []string{"feat-a"}},
		},
	}

	if err := saveProgramManifest(path, orig); err != nil {
		t.Fatalf("saveProgramManifest: %v", err)
	}

	loaded, err := protocol.ParseProgramManifest(path)
	if err != nil {
		t.Fatalf("ParseProgramManifest: %v", err)
	}

	if loaded.ProgramSlug != orig.ProgramSlug {
		t.Errorf("ProgramSlug = %q, want %q", loaded.ProgramSlug, orig.ProgramSlug)
	}
	if len(loaded.Impls) != 1 || loaded.Impls[0].Slug != "feat-a" {
		t.Errorf("Impls = %v, want [{feat-a ...}]", loaded.Impls)
	}
	if len(loaded.Tiers) != 1 || loaded.Tiers[0].Number != 1 {
		t.Errorf("Tiers = %v, want [{1 [feat-a]}]", loaded.Tiers)
	}
}

// TestHandleImportIMPLs_ResponseHasEmptySlices verifies that Imported and Skipped
// are empty JSON arrays (not null) when nothing is imported or skipped.
func TestHandleImportIMPLs_ResponseHasEmptySlices(t *testing.T) {
	s, dir := makeTestServer(t)

	// Pre-create manifest with the impl already present so everything skips.
	implPath := writeIMPLDoc(t, dir, "pre-existing", minimalIMPLForImport)

	// First import to create manifest.
	req1 := httptest.NewRequest(http.MethodPost, "/api/impl/import", mustMarshal(t, ImportIMPLsRequest{
		ProgramSlug: "empty-prog",
		IMPLPaths:   []string{implPath},
		RepoDir:     dir,
	}))
	rr1 := httptest.NewRecorder()
	s.handleImportIMPLs(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Fatalf("setup import failed: %d %s", rr1.Code, rr1.Body.String())
	}

	// Second import — same impl, should produce empty imported, one skip.
	req2 := httptest.NewRequest(http.MethodPost, "/api/impl/import", mustMarshal(t, ImportIMPLsRequest{
		ProgramSlug: "empty-prog",
		IMPLPaths:   []string{implPath},
		RepoDir:     dir,
	}))
	rr2 := httptest.NewRecorder()
	s.handleImportIMPLs(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("second import failed: %d %s", rr2.Code, rr2.Body.String())
	}

	// Verify the JSON uses [] not null for the Imported field.
	raw := rr2.Body.String()
	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("failed to decode raw JSON: %v", err)
	}

	imported, ok := decoded["imported"]
	if !ok {
		t.Fatal("response missing 'imported' key")
	}
	// JSON arrays decode to []interface{}, null decodes to nil.
	if _, isSlice := imported.([]interface{}); !isSlice {
		t.Errorf("expected imported to be a JSON array, got %T: %v", imported, imported)
	}
}

// mustMarshal is a test helper that marshals v to a JSON reader, fataling on error.
func mustMarshal(t *testing.T, v interface{}) *bytes.Buffer {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("mustMarshal: %v", err)
	}
	return bytes.NewBuffer(b)
}
