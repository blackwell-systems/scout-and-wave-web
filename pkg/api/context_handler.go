package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// handleGetContext serves GET /api/context.
// Returns the contents of docs/CONTEXT.md as text/plain.
// Returns 404 if the file does not exist.
func (s *Server) handleGetContext(w http.ResponseWriter, r *http.Request) {
	contextPath := filepath.Join(s.cfg.RepoPath, "docs", "CONTEXT.md")
	data, err := os.ReadFile(contextPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "CONTEXT.md not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to read CONTEXT.md", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

// handlePutContext serves PUT /api/context.
// Accepts a plain-text body and atomically writes it to docs/CONTEXT.md.
func (s *Server) handlePutContext(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10MB limit
	if err != nil {
		http.Error(w, "failed to read body", http.StatusInternalServerError)
		return
	}

	contextPath := filepath.Join(s.cfg.RepoPath, "docs", "CONTEXT.md")

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(contextPath), 0o755); err != nil {
		http.Error(w, "failed to create docs directory", http.StatusInternalServerError)
		return
	}

	// Atomic write: write to temp file in same directory, then rename
	tmpFile, err := os.CreateTemp(filepath.Dir(contextPath), "context-*.md.tmp")
	if err != nil {
		http.Error(w, "failed to create temp file", http.StatusInternalServerError)
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath) // clean up if rename fails

	if _, err := tmpFile.Write(body); err != nil {
		tmpFile.Close()
		http.Error(w, "failed to write temp file", http.StatusInternalServerError)
		return
	}
	if err := tmpFile.Close(); err != nil {
		http.Error(w, "failed to close temp file", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmpPath, contextPath); err != nil {
		http.Error(w, "failed to save CONTEXT.md", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
