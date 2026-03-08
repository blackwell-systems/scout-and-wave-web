package api

import "net/http"

// Stubs for new handlers — replaced by real implementations in Wave 1 (Agent C) and Wave 3 (Agents I, J).
// DO NOT remove a stub until the real implementation file is merged.

func (s *Server) handleImplDiff(w http.ResponseWriter, r *http.Request)        { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleListWorktrees(w http.ResponseWriter, r *http.Request)   { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleDeleteWorktree(w http.ResponseWriter, r *http.Request)  { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleImplChat(w http.ResponseWriter, r *http.Request)        { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleImplChatEvents(w http.ResponseWriter, r *http.Request)  { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request)       { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleSaveConfig(w http.ResponseWriter, r *http.Request)      { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleGetContext(w http.ResponseWriter, r *http.Request)      { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handlePutContext(w http.ResponseWriter, r *http.Request)      { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleScaffoldRerun(w http.ResponseWriter, r *http.Request)   { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleGetAgentContext(w http.ResponseWriter, r *http.Request) { http.Error(w, "not implemented", http.StatusNotImplemented) }
