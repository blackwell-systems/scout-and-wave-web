package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/observability"
)

// RegisterObservabilityRoutes registers all observability API endpoints on the server mux.
func (s *Server) RegisterObservabilityRoutes() {
	s.mux.HandleFunc("GET /api/observability/metrics/{impl_slug}", s.handleObsIMPLMetrics)
	s.mux.HandleFunc("GET /api/observability/metrics/program/{program_slug}", s.handleObsProgramSummary)
	s.mux.HandleFunc("GET /api/observability/events", s.handleObsQueryEvents)
	s.mux.HandleFunc("GET /api/observability/rollup", s.handleObsRollup)
	s.mux.HandleFunc("GET /api/observability/cost-breakdown/{impl_slug}", s.handleObsCostBreakdown)
}

// obsStore returns the observability store, or nil if not configured.
func (s *Server) obsStore() observability.Store {
	s.obsMu.RLock()
	defer s.obsMu.RUnlock()
	return s.obsStoreInstance
}

// SetObservabilityStore sets the observability store for API handlers.
// This is called during server initialization.
func (s *Server) SetObservabilityStore(store observability.Store) {
	s.obsMu.Lock()
	defer s.obsMu.Unlock()
	s.obsStoreInstance = store
}

func (s *Server) handleObsIMPLMetrics(w http.ResponseWriter, r *http.Request) {
	store := s.obsStore()
	if store == nil {
		http.Error(w, `{"error":"observability store not configured"}`, http.StatusInternalServerError)
		return
	}

	implSlug := r.PathValue("impl_slug")
	if implSlug == "" {
		http.Error(w, `{"error":"impl_slug is required"}`, http.StatusBadRequest)
		return
	}

	metrics, err := observability.GetIMPLMetrics(r.Context(), store, implSlug)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

func (s *Server) handleObsProgramSummary(w http.ResponseWriter, r *http.Request) {
	store := s.obsStore()
	if store == nil {
		http.Error(w, `{"error":"observability store not configured"}`, http.StatusInternalServerError)
		return
	}

	programSlug := r.PathValue("program_slug")
	if programSlug == "" {
		http.Error(w, `{"error":"program_slug is required"}`, http.StatusBadRequest)
		return
	}

	summary, err := observability.GetProgramSummary(r.Context(), store, programSlug)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}

func (s *Server) handleObsQueryEvents(w http.ResponseWriter, r *http.Request) {
	store := s.obsStore()
	if store == nil {
		http.Error(w, `{"error":"observability store not configured"}`, http.StatusInternalServerError)
		return
	}

	filters, err := parseQueryFilters(r)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	events, err := store.QueryEvents(r.Context(), filters)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

func (s *Server) handleObsRollup(w http.ResponseWriter, r *http.Request) {
	store := s.obsStore()
	if store == nil {
		http.Error(w, `{"error":"observability store not configured"}`, http.StatusInternalServerError)
		return
	}

	req, err := parseRollupRequest(r)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	var result *observability.RollupResult
	switch req.Type {
	case "cost":
		result, err = observability.ComputeCostRollup(r.Context(), store, req)
	case "success_rate":
		result, err = observability.ComputeSuccessRateRollup(r.Context(), store, req)
	case "retry":
		// Map "retry" param to "retry_count" rollup type.
		req.Type = "retry_count"
		result, err = observability.ComputeRetryRollup(r.Context(), store, req)
	default:
		http.Error(w, `{"error":"type must be cost, success_rate, or retry"}`, http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleObsCostBreakdown(w http.ResponseWriter, r *http.Request) {
	store := s.obsStore()
	if store == nil {
		http.Error(w, `{"error":"observability store not configured"}`, http.StatusInternalServerError)
		return
	}

	implSlug := r.PathValue("impl_slug")
	if implSlug == "" {
		http.Error(w, `{"error":"impl_slug is required"}`, http.StatusBadRequest)
		return
	}

	breakdown, err := observability.GetCostBreakdown(r.Context(), store, implSlug)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(breakdown)
}

// parseQueryFilters extracts QueryFilters from HTTP query parameters.
func parseQueryFilters(r *http.Request) (observability.QueryFilters, error) {
	q := r.URL.Query()
	var f observability.QueryFilters

	if v := q.Get("type"); v != "" {
		f.EventTypes = strings.Split(v, ",")
	}
	if v := q.Get("impl"); v != "" {
		f.IMPLSlugs = strings.Split(v, ",")
	}
	if v := q.Get("program"); v != "" {
		f.ProgramSlugs = strings.Split(v, ",")
	}
	if v := q.Get("agent"); v != "" {
		f.AgentIDs = strings.Split(v, ",")
	}
	if v := q.Get("start_time"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return f, err
		}
		f.StartTime = &t
	}
	if v := q.Get("end_time"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return f, err
		}
		f.EndTime = &t
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return f, err
		}
		f.Limit = n
	}
	if v := q.Get("offset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return f, err
		}
		f.Offset = n
	}

	// Default limit to prevent unbounded queries.
	if f.Limit == 0 {
		f.Limit = 100
	}

	return f, nil
}

// parseRollupRequest extracts a RollupRequest from HTTP query parameters.
func parseRollupRequest(r *http.Request) (observability.RollupRequest, error) {
	q := r.URL.Query()
	var req observability.RollupRequest

	req.Type = q.Get("type")
	if req.Type == "" {
		return req, &rollupParamError{"type is required"}
	}

	if v := q.Get("group_by"); v != "" {
		req.GroupBy = strings.Split(v, ",")
	}
	req.IMPLSlug = q.Get("impl")
	req.ProgramSlug = q.Get("program")

	if v := q.Get("start_time"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return req, err
		}
		req.StartTime = &t
	}
	if v := q.Get("end_time"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return req, err
		}
		req.EndTime = &t
	}

	return req, nil
}

type rollupParamError struct {
	msg string
}

func (e *rollupParamError) Error() string { return e.msg }
