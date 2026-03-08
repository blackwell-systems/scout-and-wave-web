package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/git"
)

// handleGitActivity serves GET /api/git/{slug}/activity as an SSE stream.
// It polls the repository every 5 seconds and emits git_activity events.
func (s *Server) handleGitActivity(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	poller := git.NewPoller(s.cfg.RepoPath, slug)

	// Poll immediately before starting the ticker.
	if snap, err := poller.Snapshot(); err != nil {
		log.Printf("git activity poll error: %v", err)
	} else {
		data, _ := json.Marshal(snap)
		fmt.Fprintf(w, "event: git_activity\ndata: %s\n\n", data)
		flusher.Flush()
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			snap, err := poller.Snapshot()
			if err != nil {
				log.Printf("git activity poll error: %v", err)
				continue
			}
			data, _ := json.Marshal(snap)
			fmt.Fprintf(w, "event: git_activity\ndata: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
