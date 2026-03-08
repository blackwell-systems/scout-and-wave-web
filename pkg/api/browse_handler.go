// Package api browse_handler.go
//
// Why server-side browsing instead of a native OS file picker:
//
// Browsers deliberately block access to the local filesystem path string for
// security reasons. <input type="file"> gives you file *contents*, not the
// path on disk, and webkitdirectory only works for uploading — neither works
// for configuring a repo path that the Go server needs to resolve.
//
// Since the saw server runs on localhost with full OS access, we expose a
// /api/browse endpoint that walks the real filesystem and returns directory
// listings as JSON. The React frontend renders these as a navigable picker,
// giving users a proper folder-selection experience without any native dialog.

package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type browseEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
}

type browseResponse struct {
	Path    string        `json:"path"`
	Parent  string        `json:"parent"`
	Entries []browseEntry `json:"entries"`
}

func (s *Server) handleBrowse(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = "/"
		}
		path = home
	}
	path = filepath.Clean(path)

	entries, err := os.ReadDir(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var dirs []browseEntry
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		dirs = append(dirs, browseEntry{Name: name, IsDir: true})
	}
	sort.Slice(dirs, func(i, j int) bool {
		return dirs[i].Name < dirs[j].Name
	})

	parent := filepath.Dir(path)
	if parent == path {
		parent = ""
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(browseResponse{
		Path:    path,
		Parent:  parent,
		Entries: dirs,
	})
}
