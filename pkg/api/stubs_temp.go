package api

import "net/http"

// TEMP: Stub handlers owned by Agent A (server.go route wiring).
// These exist only to allow wave1-agent-C's worktree to build in isolation.
// Remove after Wave 1 merge — Agent A's stubs.go replaces these.

func (s *Server) handleImplChat(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}

func (s *Server) handleImplChatEvents(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}

func (s *Server) handleScaffoldRerun(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}
