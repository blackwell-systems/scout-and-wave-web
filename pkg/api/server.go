package api

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"sync"
	"time"
)

// Config holds server configuration for saw serve.
type Config struct {
	Addr     string // e.g. "localhost:7432"
	IMPLDir  string // directory to scan for IMPL docs (e.g. "docs/IMPL")
	RepoPath string // absolute path to the repository root
}

// Server is the HTTP server for the saw web UI.
type Server struct {
	cfg           Config
	mux           *http.ServeMux
	broker        *sseBroker    // unexported; used by wave.go handlers
	globalBroker  *globalBroker // fans out global SSE events (impl_list_updated, etc.)
	activeRuns    sync.Map      // slug -> struct{}; tracks in-progress wave runs
	scoutRuns     sync.Map      // runID -> context.CancelFunc; tracks in-progress scout runs
	reviseCancels sync.Map      // runID -> context.CancelFunc; tracks in-progress revise runs
	mergingRuns   sync.Map      // slug -> struct{}; tracks in-progress merge operations
	testingRuns   sync.Map      // slug -> struct{}; tracks in-progress test runs
	scaffoldRuns  sync.Map      // runID -> context.CancelFunc; tracks in-progress scaffold reruns
	stages        *stageManager // per-slug stage state persistence
}

// New creates a Server with the given Config and registers all routes.
func New(cfg Config) *Server {
	s := &Server{
		cfg: cfg,
		mux: http.NewServeMux(),
		broker: &sseBroker{
			clients: make(map[string][]chan SSEEvent),
		},
		globalBroker: newGlobalBroker(),
		stages:       newStageManager(cfg.IMPLDir),
	}

	// Watch the IMPL directory for new/changed docs so connected clients
	// get an impl_list_updated event without needing to poll or refresh.
	s.startIMPLWatcher(cfg.IMPLDir)

	s.mux.HandleFunc("GET /api/events", s.handleGlobalEvents)
	s.mux.HandleFunc("GET /api/browse", s.handleBrowse)
	s.mux.HandleFunc("GET /api/browse/native", s.handleBrowseNative)
	s.mux.HandleFunc("GET /api/impl", s.handleListImpls)
	s.mux.HandleFunc("GET /api/impl/{slug}", s.handleGetImpl)
	s.mux.HandleFunc("POST /api/impl/{slug}/approve", s.handleApprove)
	s.mux.HandleFunc("POST /api/impl/{slug}/reject", s.handleReject)
	s.mux.HandleFunc("GET /api/wave/{slug}/events", s.handleWaveEvents)
	s.mux.HandleFunc("GET /api/git/{slug}/activity", s.handleGitActivity)
	s.mux.HandleFunc("POST /api/wave/{slug}/start", s.handleWaveStart)
	s.mux.HandleFunc("POST /api/scout/run", s.handleScoutRun)
	s.mux.HandleFunc("POST /api/scout/{slug}/rerun", s.handleScoutRerun)
	s.mux.HandleFunc("GET /api/scout/{runID}/events", s.handleScoutEvents)
	s.mux.HandleFunc("POST /api/wave/{slug}/gate/proceed", s.handleWaveGateProceed)
	s.mux.HandleFunc("POST /api/wave/{slug}/agent/{letter}/rerun", s.handleWaveAgentRerun)
	s.mux.HandleFunc("POST /api/wave/{slug}/merge", s.handleWaveMerge)
	s.mux.HandleFunc("POST /api/wave/{slug}/test", s.handleWaveTest)
	s.mux.HandleFunc("GET /api/impl/{slug}/raw", s.handleGetImplRaw)
	s.mux.HandleFunc("PUT /api/impl/{slug}/raw", s.handlePutImplRaw)
	s.mux.HandleFunc("POST /api/impl/{slug}/revise", s.handleImplRevise)
	s.mux.HandleFunc("GET /api/impl/{slug}/revise/{runID}/events", s.handleImplReviseEvents)
	s.mux.HandleFunc("POST /api/impl/{slug}/revise/{runID}/cancel", s.handleImplReviseCancel)
	s.mux.HandleFunc("POST /api/scout/{runID}/cancel", s.handleScoutCancel)
	s.mux.HandleFunc("DELETE /api/impl/{slug}", s.handleDeleteImpl)
	s.mux.HandleFunc("POST /api/impl/{slug}/archive", s.handleArchiveImpl)

	// v0.17.0-C — File diff viewer
	s.mux.HandleFunc("GET /api/impl/{slug}/diff/{agent}", s.handleImplDiff)

	// v0.17.0-D — Worktree manager
	s.mux.HandleFunc("GET /api/impl/{slug}/worktrees", s.handleListWorktrees)
	s.mux.HandleFunc("DELETE /api/impl/{slug}/worktrees/{branch}", s.handleDeleteWorktree)
	s.mux.HandleFunc("POST /api/impl/{slug}/worktrees/cleanup", s.handleBatchDeleteWorktrees)

	// v0.18.0-B — Chat with Claude
	s.mux.HandleFunc("POST /api/impl/{slug}/chat", s.handleImplChat)
	s.mux.HandleFunc("GET /api/impl/{slug}/chat/{runID}/events", s.handleImplChatEvents)

	// v0.18.0-C — Settings
	s.mux.HandleFunc("GET /api/config", s.handleGetConfig)
	s.mux.HandleFunc("POST /api/config", s.handleSaveConfig)

	// v0.18.0-G — CONTEXT.md viewer
	s.mux.HandleFunc("GET /api/context", s.handleGetContext)
	s.mux.HandleFunc("PUT /api/context", s.handlePutContext)

	// v0.18.0-I — Scaffold rerun
	s.mux.HandleFunc("POST /api/impl/{slug}/scaffold/rerun", s.handleScaffoldRerun)

	// v0.18.0-K — Per-agent context payload
	s.mux.HandleFunc("GET /api/impl/{slug}/agent/{letter}/context", s.handleGetAgentContext)

	// v0.19.0 — Stage state machine
	s.mux.HandleFunc("GET /api/wave/{slug}/state", s.handleWaveState)

	// v0.32.0 — Manifest routes (validate, load, wave, completion)
	s.RegisterManifestRoutes()

	// File browser API — tree, read, diff, status
	s.mux.HandleFunc("GET /api/files/tree", s.handleFilesTree)
	s.mux.HandleFunc("GET /api/files/read", s.handleFilesRead)
	s.mux.HandleFunc("GET /api/files/diff", s.handleFilesDiff)
	s.mux.HandleFunc("GET /api/files/status", s.handleFilesStatus)

	// Journal API — Tool journaling for Observatory UI
	s.mux.HandleFunc("GET /api/journal/{wave}/{agent}", s.handleJournalGet)
	s.mux.HandleFunc("GET /api/journal/{wave}/{agent}/summary", s.handleJournalSummary)
	s.mux.HandleFunc("GET /api/journal/{wave}/{agent}/checkpoints", s.handleJournalCheckpoints)
	s.mux.HandleFunc("POST /api/journal/{wave}/{agent}/restore", s.handleJournalRestore)

	sub, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		panic("saw: failed to sub embed.FS: " + err.Error())
	}
	s.mux.Handle("/", http.FileServer(http.FS(sub)))

	return s
}

// Start starts the HTTP server and blocks until ctx is cancelled or a fatal
// error occurs. Callers (cmd/saw/serve_cmd.go) pass a context that is
// cancelled on SIGINT.
func (s *Server) Start(ctx context.Context) error {
	return s.StartTLS(ctx, "", "")
}

// StartTLS starts the server. When certFile and keyFile are both non-empty it
// serves HTTPS (enabling HTTP/2 automatically via Go's stdlib). When they are
// empty it falls back to plain HTTP/1.1.
func (s *Server) StartTLS(ctx context.Context, certFile, keyFile string) error {
	srv := &http.Server{
		Addr:    s.cfg.Addr,
		Handler: s.mux,
	}

	useTLS := certFile != "" && keyFile != ""

	errCh := make(chan error, 1)
	go func() {
		var err error
		if useTLS {
			err = srv.ListenAndServeTLS(certFile, keyFile)
		} else {
			err = srv.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("saw serve: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
