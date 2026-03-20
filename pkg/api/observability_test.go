package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/observability"
)

// mockObsStore implements observability.Store for testing.
type mockObsStore struct {
	events  []observability.Event
	rollup  *observability.RollupResult
	queryFn func(ctx context.Context, filters observability.QueryFilters) ([]observability.Event, error)
}

func (m *mockObsStore) RecordEvent(_ context.Context, _ observability.Event) error { return nil }
func (m *mockObsStore) QueryEvents(ctx context.Context, f observability.QueryFilters) ([]observability.Event, error) {
	if m.queryFn != nil {
		return m.queryFn(ctx, f)
	}
	return m.events, nil
}
func (m *mockObsStore) GetRollup(_ context.Context, _ observability.RollupRequest) (*observability.RollupResult, error) {
	return m.rollup, nil
}
func (m *mockObsStore) Close() error { return nil }

func newTestServerWithObs(store observability.Store) *Server {
	s := &Server{
		mux: http.NewServeMux(),
	}
	s.SetObservabilityStore(store)
	s.RegisterObservabilityRoutes()
	return s
}

func TestHandleObsIMPLMetrics(t *testing.T) {
	now := time.Now()
	store := &mockObsStore{
		queryFn: func(_ context.Context, f observability.QueryFilters) ([]observability.Event, error) {
			if len(f.EventTypes) > 0 && f.EventTypes[0] == "cost" {
				return []observability.Event{
					&observability.CostEvent{
						ID: "c1", Type: "cost", Time: now,
						AgentID: "A", IMPLSlug: "test-impl", CostUSD: 1.50,
					},
				}, nil
			}
			if len(f.EventTypes) > 0 && f.EventTypes[0] == "agent_performance" {
				return []observability.Event{
					&observability.AgentPerformanceEvent{
						ID: "p1", Type: "agent_performance", Time: now,
						AgentID: "A", IMPLSlug: "test-impl", Status: "success",
						DurationSeconds: 120,
					},
				}, nil
			}
			return nil, nil
		},
	}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/metrics/test-impl", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var metrics observability.IMPLMetrics
	if err := json.NewDecoder(w.Body).Decode(&metrics); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if metrics.TotalCost != 1.50 {
		t.Errorf("expected total_cost 1.50, got %f", metrics.TotalCost)
	}
	if metrics.SuccessRate != 1.0 {
		t.Errorf("expected success_rate 1.0, got %f", metrics.SuccessRate)
	}
}

func TestHandleObsProgramSummary(t *testing.T) {
	now := time.Now()
	store := &mockObsStore{
		queryFn: func(_ context.Context, f observability.QueryFilters) ([]observability.Event, error) {
			if len(f.EventTypes) > 0 && f.EventTypes[0] == "cost" {
				return []observability.Event{
					&observability.CostEvent{
						ID: "c1", Type: "cost", Time: now,
						ProgramSlug: "prog-1", CostUSD: 3.00,
					},
				}, nil
			}
			if len(f.EventTypes) > 0 && f.EventTypes[0] == "agent_performance" {
				return []observability.Event{
					&observability.AgentPerformanceEvent{
						ID: "p1", Type: "agent_performance", Time: now,
						IMPLSlug: "impl-1", ProgramSlug: "prog-1", Status: "success",
						DurationSeconds: 60,
					},
				}, nil
			}
			return nil, nil
		},
	}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/metrics/program/prog-1", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var summary observability.ProgramSummary
	if err := json.NewDecoder(w.Body).Decode(&summary); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if summary.TotalCost != 3.00 {
		t.Errorf("expected total_cost 3.00, got %f", summary.TotalCost)
	}
	if summary.IMPLCount != 1 {
		t.Errorf("expected impl_count 1, got %d", summary.IMPLCount)
	}
}

func TestHandleObsQueryEvents(t *testing.T) {
	now := time.Now()
	store := &mockObsStore{
		events: []observability.Event{
			&observability.CostEvent{
				ID: "c1", Type: "cost", Time: now,
				AgentID: "A", IMPLSlug: "test-impl", CostUSD: 0.50,
			},
		},
	}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/events?type=cost&impl=test-impl&limit=10", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var events []json.RawMessage
	if err := json.NewDecoder(w.Body).Decode(&events); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(events) != 1 {
		t.Errorf("expected 1 event, got %d", len(events))
	}
}

func TestHandleObsQueryEventsInvalidTime(t *testing.T) {
	store := &mockObsStore{}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/events?start_time=not-a-time", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleObsRollup(t *testing.T) {
	now := time.Now()
	store := &mockObsStore{
		queryFn: func(_ context.Context, f observability.QueryFilters) ([]observability.Event, error) {
			return []observability.Event{
				&observability.CostEvent{
					ID: "c1", Type: "cost", Time: now,
					AgentID: "A", CostUSD: 2.00,
				},
				&observability.CostEvent{
					ID: "c2", Type: "cost", Time: now,
					AgentID: "B", CostUSD: 3.00,
				},
			}, nil
		},
	}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/rollup?type=cost&group_by=agent", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result observability.RollupResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.TotalCost != 5.00 {
		t.Errorf("expected total_cost 5.00, got %f", result.TotalCost)
	}
}

func TestHandleObsRollupMissingType(t *testing.T) {
	store := &mockObsStore{}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/rollup", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleObsRollupInvalidType(t *testing.T) {
	store := &mockObsStore{}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/rollup?type=invalid", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleObsCostBreakdown(t *testing.T) {
	now := time.Now()
	store := &mockObsStore{
		queryFn: func(_ context.Context, f observability.QueryFilters) ([]observability.Event, error) {
			return []observability.Event{
				&observability.CostEvent{
					ID: "c1", Type: "cost", Time: now,
					AgentID: "A", IMPLSlug: "test-impl", CostUSD: 1.00,
				},
				&observability.CostEvent{
					ID: "c2", Type: "cost", Time: now,
					AgentID: "B", IMPLSlug: "test-impl", CostUSD: 2.50,
				},
			}, nil
		},
	}
	s := newTestServerWithObs(store)

	req := httptest.NewRequest("GET", "/api/observability/cost-breakdown/test-impl", nil)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var breakdown map[string]float64
	if err := json.NewDecoder(w.Body).Decode(&breakdown); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if breakdown["A"] != 1.00 {
		t.Errorf("expected A=1.00, got %f", breakdown["A"])
	}
	if breakdown["B"] != 2.50 {
		t.Errorf("expected B=2.50, got %f", breakdown["B"])
	}
}

func TestHandleObsNoStore(t *testing.T) {
	s := &Server{mux: http.NewServeMux()}
	s.RegisterObservabilityRoutes()

	endpoints := []string{
		"/api/observability/metrics/test-impl",
		"/api/observability/metrics/program/test-prog",
		"/api/observability/events",
		"/api/observability/rollup?type=cost",
		"/api/observability/cost-breakdown/test-impl",
	}
	for _, ep := range endpoints {
		req := httptest.NewRequest("GET", ep, nil)
		w := httptest.NewRecorder()
		s.mux.ServeHTTP(w, req)
		if w.Code != http.StatusInternalServerError {
			t.Errorf("%s: expected 500, got %d", ep, w.Code)
		}
	}
}
