package api

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/observability"
	"github.com/blackwell-systems/scout-and-wave-web/build"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

// Config holds server configuration for saw serve.
type Config struct {
	Addr     string // e.g. "localhost:7432"
	IMPLDir  string // directory to scan for IMPL docs (e.g. "docs/IMPL")
	RepoPath string // absolute path to the repository root
}

// Server is the HTTP server for the saw web UI.
type Server struct {
	cfg              Config
	mux              *http.ServeMux
	broker           *sseBroker      // unexported; used by wave.go handlers
	globalBroker     *globalBroker   // fans out global SSE events (impl_list_updated, etc.)
	notificationBus  *NotificationBus // central hub for user-facing notifications
	serverCtx        context.Context  // cancelled on server shutdown; passed to long-running goroutines
	serverCancel     context.CancelFunc // cancels serverCtx
	activeRuns       sync.Map        // slug -> struct{}; tracks in-progress wave runs
	scoutRuns        sync.Map        // runID -> context.CancelFunc; tracks in-progress scout runs
	plannerRuns      sync.Map        // runID -> context.CancelFunc; tracks in-progress planner runs
	reviseCancels    sync.Map        // runID -> context.CancelFunc; tracks in-progress revise runs
	activeProgramRuns sync.Map       // slug -> struct{}; program tier executions
	mergingRuns      sync.Map        // slug -> struct{}; tracks in-progress merge operations
	testingRuns      sync.Map        // slug -> struct{}; tracks in-progress test runs
	scaffoldRuns     sync.Map        // runID -> context.CancelFunc; tracks in-progress scaffold reruns
	interviewRuns    sync.Map        // runID -> context.CancelFunc; tracks in-progress interview runs
	stages           *stageManager    // per-slug stage state persistence
	pipelineTracker  *pipelineTracker // per-slug pipeline step state persistence
	progressTracker  *ProgressTracker // tracks per-agent progress
	commitCounts     sync.Map        // "slug/wave/agent" -> int; tracks git commit counts per agent
	filesOwnedCache  sync.Map        // "slug/wave/agent" -> []string; caches files owned per agent
	agentSnapshots   sync.Map        // slug -> *agentSnapshot; latest agent lifecycle event per agent for SSE replay
	implListCache    *implCache       // in-memory cache for handleListImpls metadata
	svcDeps          service.Deps     // dependency injection for service layer
	obsMu            sync.RWMutex            // guards obsStoreInstance
	obsStoreInstance observability.Store      // observability event store (may be nil)
}

// ssoServiceAdapter bridges the api.SSOService interface to the package-level
// functions in pkg/service.  It converts between the api and service request/
// response types so the SSO HTTP handlers can call the real AWS implementation.
type ssoServiceAdapter struct{}

func (a *ssoServiceAdapter) StartSSODeviceAuth(ctx context.Context, req SSOStartRequest) (*SSOStartResponse, error) {
	svcReq := service.SSOStartRequest{
		Profile: req.Profile,
		Region:  req.Region,
	}
	svcResp, err := service.StartSSODeviceAuth(ctx, svcReq)
	if err != nil {
		return nil, err
	}
	return &SSOStartResponse{
		VerificationURI:         svcResp.VerificationURI,
		VerificationURIComplete: svcResp.VerificationURIComplete,
		UserCode:                svcResp.UserCode,
		DeviceCode:              svcResp.DeviceCode,
		ClientID:                svcResp.ClientID,
		ClientSecret:            svcResp.ClientSecret,
		ExpiresIn:               svcResp.ExpiresIn,
		Interval:                svcResp.Interval,
		PollID:                  svcResp.PollID,
	}, nil
}

func (a *ssoServiceAdapter) PollSSODeviceAuth(ctx context.Context, req SSOPollRequest) (*SSOPollResponse, error) {
	svcReq := service.SSOPollRequest{
		PollID: req.PollID,
	}
	svcResp, err := service.PollSSODeviceAuth(ctx, svcReq)
	if err != nil {
		return nil, err
	}
	return &SSOPollResponse{
		Status:   svcResp.Status,
		Identity: svcResp.Identity,
		Error:    svcResp.Error,
	}, nil
}

// getConfiguredRepos reads saw.config.json using the SDK config package and
// returns the list of configured repos. Falls back to a single entry using
// s.cfg.RepoPath if no config or no repos are configured.
func (s *Server) getConfiguredRepos() []config.RepoEntry {
	sdkCfg := config.LoadOrDefault(s.cfg.RepoPath)
	if len(sdkCfg.Repos) > 0 {
		return sdkCfg.Repos
	}
	return []config.RepoEntry{{
		Name: filepath.Base(s.cfg.RepoPath),
		Path: s.cfg.RepoPath,
	}}
}

// New creates a Server with the given Config and registers all routes.
func New(cfg Config) *Server {
	globalBroker := newGlobalBroker()
	serverCtx, serverCancel := context.WithCancel(context.Background())
	broker := &sseBroker{
		clients: make(map[string][]chan SSEEvent),
	}

	// Construct service layer dependencies.
	ssePublisher := NewSSEPublisher(broker, globalBroker)
	svcDeps := service.Deps{
		RepoPath:  cfg.RepoPath,
		IMPLDir:   cfg.IMPLDir,
		Publisher: ssePublisher,
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}

	s := &Server{
		cfg:             cfg,
		mux:             http.NewServeMux(),
		broker:          broker,
		globalBroker:    globalBroker,
		notificationBus: NewNotificationBus(globalBroker),
		serverCtx:       serverCtx,
		serverCancel:    serverCancel,
		stages:          newStageManager(cfg.IMPLDir),
		pipelineTracker: newPipelineTracker(cfg.IMPLDir),
		progressTracker: NewProgressTracker(),
		implListCache:   &implCache{entries: make(map[string]cachedImplEntry)},
		svcDeps:         svcDeps,
	}

	// Populate fallback config so runWaveLoop can use it for cross-repo IMPLs
	// that don't have their own saw.config.json.
	fallbackSAWConfig = config.LoadOrDefault(cfg.RepoPath)

	// Set the package-level pipeline tracker so runFinalizeSteps can use it.
	defaultPipelineTracker = s.pipelineTracker

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
	s.mux.HandleFunc("POST /api/wave/{slug}/start", s.handleWaveStart)
	s.mux.HandleFunc("POST /api/scout/run", s.handleScoutRun)
	s.mux.HandleFunc("POST /api/scout/{slug}/rerun", s.handleScoutRerun)
	s.mux.HandleFunc("GET /api/scout/{runID}/events", s.handleScoutEvents)
	s.mux.HandleFunc("POST /api/wave/{slug}/gate/proceed", s.handleWaveGateProceed)
	s.mux.HandleFunc("POST /api/wave/{slug}/agent/{letter}/rerun", s.handleWaveAgentRerun)
	s.mux.HandleFunc("POST /api/wave/{slug}/merge", s.handleWaveMerge)
	s.mux.HandleFunc("POST /api/wave/{slug}/finalize", s.handleWaveFinalize)
	s.mux.HandleFunc("POST /api/wave/{slug}/merge-abort", s.handleMergeAbort)
	s.RegisterConflictRoutes()
	s.RegisterAmendRoutes()
	s.RegisterCriticRoutes()
	s.RegisterValidationRoutes()
	s.mux.HandleFunc("POST /api/wave/{slug}/test", s.handleWaveTest)
	s.mux.HandleFunc("GET /api/impl/{slug}/raw", s.handleGetImplRaw)
	s.mux.HandleFunc("PUT /api/impl/{slug}/raw", s.handlePutImplRaw)
	s.mux.HandleFunc("POST /api/impl/{slug}/revise", s.handleImplRevise)
	s.mux.HandleFunc("GET /api/impl/{slug}/revise/{runID}/events", s.handleImplReviseEvents)
	s.mux.HandleFunc("POST /api/impl/{slug}/revise/{runID}/cancel", s.handleImplReviseCancel)
	s.mux.HandleFunc("POST /api/scout/{runID}/cancel", s.handleScoutCancel)
	s.mux.HandleFunc("DELETE /api/impl/{slug}", s.handleDeleteImpl)
	s.mux.HandleFunc("POST /api/impl/{slug}/archive", s.handleArchiveImpl)

	// Recovery control routes — step-level retry, skip, force-complete, pipeline state
	s.RegisterRecoveryRoutes()

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
	s.mux.HandleFunc("GET /api/sessions/interrupted", s.handleInterruptedSessions)
	s.mux.HandleFunc("POST /api/wave/{slug}/resume", s.handleResumeExecution)

	s.mux.HandleFunc("GET /api/config", s.handleGetConfig)
	s.mux.HandleFunc("POST /api/config", s.handleSaveConfig)
	s.mux.HandleFunc("POST /api/config/validate-repo", s.handleValidateRepoPath)
	s.mux.HandleFunc("POST /api/config/providers/{provider}/validate", s.handleValidateProvider)

	// AWS SSO device auth flow
	SetSSOService(&ssoServiceAdapter{})
	s.RegisterSSORoutes()

	// Bootstrap — greenfield project initialization
	s.mux.HandleFunc("POST /api/bootstrap/run", s.handleBootstrapRun)

	// Notification preferences
	s.mux.HandleFunc("GET /api/notifications/preferences", s.handleGetNotificationPrefs)
	s.mux.HandleFunc("POST /api/notifications/preferences", s.handleSaveNotificationPrefs)

	// v0.18.0-G — CONTEXT.md viewer
	s.mux.HandleFunc("GET /api/context", s.handleGetContext)
	s.mux.HandleFunc("PUT /api/context", s.handlePutContext)

	// v0.18.0-I — Scaffold rerun
	s.mux.HandleFunc("POST /api/impl/{slug}/scaffold/rerun", s.handleScaffoldRerun)

	// v0.18.0-K — Per-agent context payload
	s.mux.HandleFunc("GET /api/impl/{slug}/agent/{letter}/context", s.handleGetAgentContext)

	// v0.19.0 — Stage state machine
	s.mux.HandleFunc("GET /api/wave/{slug}/state", s.handleWaveState)

	// Agent progress tracking
	s.mux.HandleFunc("GET /api/wave/{slug}/status", s.handleWaveStatus)
	s.mux.HandleFunc("GET /api/wave/{slug}/disk-status", s.handleWaveDiskStatus)
	s.mux.HandleFunc("GET /api/wave/{slug}/review/{wave}", s.handleGetReview)

	// v0.32.0 — Manifest routes (validate, load, wave, completion)
	s.RegisterManifestRoutes()

	// Observability API — metrics, events, rollups, cost breakdown
	s.RegisterObservabilityRoutes()

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

	// Planner layer — launch Planner agent to produce PROGRAM manifests
	s.mux.HandleFunc("POST /api/planner/run", s.handlePlannerRun)
	s.mux.HandleFunc("GET /api/planner/{runID}/events", s.handlePlannerEvents)
	s.mux.HandleFunc("POST /api/planner/{runID}/cancel", s.handlePlannerCancel)

	// Program layer — PROGRAM manifest management, tier execution, contracts, replan
	s.mux.HandleFunc("GET /api/programs", s.handleListPrograms)
	s.mux.HandleFunc("GET /api/program/{slug}", s.handleGetProgramStatus)
	s.mux.HandleFunc("GET /api/program/{slug}/tier/{n}", s.handleGetTierStatus)
	s.mux.HandleFunc("POST /api/program/{slug}/tier/{n}/execute", s.handleExecuteTier)
	s.mux.HandleFunc("GET /api/program/{slug}/contracts", s.handleGetProgramContracts)
	s.mux.HandleFunc("POST /api/program/{slug}/replan", s.handleReplanProgram)
	s.mux.HandleFunc("POST /api/programs/analyze-impls", s.handleAnalyzeImpls)
	s.mux.HandleFunc("POST /api/programs/create-from-impls", s.handleCreateFromImpls)
	s.mux.HandleFunc("GET /api/program/events", s.handleProgramEvents)

	// Autonomy layer (v0.58.0)
	// Note: pipeline_updated is broadcast by queue and daemon handlers when state changes.
	s.mux.HandleFunc("GET /api/pipeline", s.handleGetPipeline)
	s.mux.HandleFunc("GET /api/queue", s.handleListQueue)
	s.mux.HandleFunc("POST /api/queue", s.handleAddQueue)
	s.mux.HandleFunc("DELETE /api/queue/{slug}", s.handleDeleteQueue)
	s.mux.HandleFunc("PUT /api/queue/{slug}/priority", s.handleReorderQueue)
	s.mux.HandleFunc("GET /api/autonomy", s.handleGetAutonomy)
	s.mux.HandleFunc("PUT /api/autonomy", s.handleSaveAutonomy)
	// Stale worktree cleanup — manual trigger across all repos
	s.mux.HandleFunc("POST /api/worktrees/cleanup-stale", s.handleGlobalStaleCleanup)

	s.mux.HandleFunc("POST /api/daemon/start", s.handleDaemonStart)
	s.mux.HandleFunc("POST /api/daemon/stop", s.handleDaemonStop)
	s.mux.HandleFunc("GET /api/daemon/status", s.handleDaemonStatus)
	s.mux.HandleFunc("GET /api/daemon/events", s.handleDaemonEvents)

	// Interview layer — launch interview agent to refine feature descriptions
	s.mux.HandleFunc("POST /api/interview/start", s.handleInterviewStart)
	s.mux.HandleFunc("GET /api/interview/{runID}/events", s.handleInterviewEvents)
	s.mux.HandleFunc("POST /api/interview/{runID}/answer", s.handleInterviewAnswer)
	s.mux.HandleFunc("POST /api/interview/{runID}/cancel", s.handleInterviewCancel)


	// Import route — bulk IMPL import into a program
	s.mux.HandleFunc("POST /api/impl/import", s.handleImportIMPLs)

	sub, err := build.StaticFS()
	if err != nil {
		panic("saw: failed to get static FS: " + err.Error())
	}
	if sub != nil {
		s.mux.Handle("/", http.FileServer(http.FS(sub)))
	}

	// Start background stale worktree cleanup loop.
	go s.StartStaleCleanupLoop(serverCtx)

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
	useTLS := certFile != "" && keyFile != ""

	// For plain HTTP, wrap with h2c to enable cleartext HTTP/2.
	// This eliminates the browser's 6-connection-per-domain limit that
	// causes UI hangs when multiple SSE EventSource streams are open.
	var handler http.Handler = s.mux
	if !useTLS {
		h2s := &http2.Server{}
		handler = h2c.NewHandler(s.mux, h2s)
	}

	srv := &http.Server{
		Addr:    s.cfg.Addr,
		Handler: handler,
	}

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
		s.serverCancel() // signal long-running goroutines (e.g. program tier execution)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
