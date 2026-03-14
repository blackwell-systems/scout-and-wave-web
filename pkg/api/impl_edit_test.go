package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestHandleGetImplRaw_Found creates a temp IMPL doc, calls GET /api/impl/{slug}/raw,
// and asserts 200 with the correct content-type and body.
func TestHandleGetImplRaw_Found(t *testing.T) {
	s, dir := makeTestServer(t)
	const slug = "test-feature"
	const content = "title: test-feature\nfeature_slug: test-feature\nverdict: SUITABLE\n"

	// Write directly to docs/IMPL (not using writeIMPLDoc since we want specific content)
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create IMPL dir: %v", err)
	}
	path := filepath.Join(implDir, "IMPL-"+slug+".yaml")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write IMPL doc: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/impl/"+slug+"/raw", nil)
	req.SetPathValue("slug", slug)
	w := httptest.NewRecorder()

	s.handleGetImplRaw(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("expected Content-Type text/plain, got %q", ct)
	}
	body := w.Body.String()
	if body != content {
		t.Errorf("expected body %q, got %q", content, body)
	}
}

// TestHandleGetImplRaw_NotFound calls GET for a nonexistent slug and asserts 404.
func TestHandleGetImplRaw_NotFound(t *testing.T) {
	s, _ := makeTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/impl/nonexistent/raw", nil)
	req.SetPathValue("slug", "nonexistent")
	w := httptest.NewRecorder()

	s.handleGetImplRaw(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// TestHandlePutImplRaw_Success calls PUT with a markdown body, asserts 200,
// then reads the file back and verifies the content matches.
func TestHandlePutImplRaw_Success(t *testing.T) {
	s, dir := makeTestServer(t)
	const slug = "edit-target"
	const newContent = "# IMPL: edit-target\n\nUpdated content.\n"

	req := httptest.NewRequest(http.MethodPut, "/api/impl/"+slug+"/raw", strings.NewReader(newContent))
	req.ContentLength = int64(len(newContent))
	req.SetPathValue("slug", slug)
	w := httptest.NewRecorder()

	s.handlePutImplRaw(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify file was written correctly
	implPath := filepath.Join(dir, "docs", "IMPL", "IMPL-"+slug+".yaml")
	data, err := os.ReadFile(implPath)
	if err != nil {
		t.Fatalf("could not read written file: %v", err)
	}
	if string(data) != newContent {
		t.Errorf("expected file content %q, got %q", newContent, string(data))
	}
}

// TestHandlePutImplRaw_EmptyBody calls PUT with an empty body and asserts 400.
func TestHandlePutImplRaw_EmptyBody(t *testing.T) {
	s, _ := makeTestServer(t)

	req := httptest.NewRequest(http.MethodPut, "/api/impl/some-slug/raw", strings.NewReader(""))
	req.ContentLength = 0
	req.SetPathValue("slug", "some-slug")
	w := httptest.NewRecorder()

	s.handlePutImplRaw(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
