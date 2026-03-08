package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// handleGetImplRaw serves GET /api/impl/{slug}/raw
// Returns the raw IMPL doc markdown as text/plain.
func (s *Server) handleGetImplRaw(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}
	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")
	data, err := os.ReadFile(implPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "IMPL doc not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to read IMPL doc", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// handlePutImplRaw serves PUT /api/impl/{slug}/raw
// Accepts raw markdown body and atomically writes it to the IMPL doc.
func (s *Server) handlePutImplRaw(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}
	if r.ContentLength == 0 {
		http.Error(w, "empty body", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10MB limit
	if err != nil {
		http.Error(w, "failed to read body", http.StatusInternalServerError)
		return
	}
	if len(body) == 0 {
		http.Error(w, "empty body", http.StatusBadRequest)
		return
	}
	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")
	// Atomic write via temp file + rename
	tmpFile, err := os.CreateTemp(filepath.Dir(implPath), "impl-edit-*.md.tmp")
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
	if err := os.Rename(tmpPath, implPath); err != nil {
		http.Error(w, "failed to save IMPL doc", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}
