package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mockSSOService implements SSOService for handler tests.
type mockSSOService struct {
	startResp *SSOStartResponse
	startErr  error
	pollResp  *SSOPollResponse
	pollErr   error
}

func (m *mockSSOService) StartSSODeviceAuth(_ context.Context, _ SSOStartRequest) (*SSOStartResponse, error) {
	return m.startResp, m.startErr
}

func (m *mockSSOService) PollSSODeviceAuth(_ context.Context, _ SSOPollRequest) (*SSOPollResponse, error) {
	return m.pollResp, m.pollErr
}

// newTestSSOServer creates a minimal Server with SSO routes registered and
// the given mock wired in.
func newTestSSOServer(t *testing.T, mock *mockSSOService) *http.ServeMux {
	t.Helper()
	oldSvc := ssoSvcRegistry
	t.Cleanup(func() { ssoSvcRegistry = oldSvc })
	SetSSOService(mock)

	mux := http.NewServeMux()
	s := &Server{mux: mux}
	s.RegisterSSORoutes()
	return mux
}

// ---------- handleSSOStart tests ----------

func TestSSOStart_ValidRequest(t *testing.T) {
	mock := &mockSSOService{
		startResp: &SSOStartResponse{
			VerificationURI:         "https://device.sso.us-east-1.amazonaws.com/",
			VerificationURIComplete: "https://device.sso.us-east-1.amazonaws.com/?user_code=ABCD-EFGH",
			UserCode:                "ABCD-EFGH",
			DeviceCode:              "secret-device-code",
			ClientID:                "secret-client-id",
			ClientSecret:            "secret-client-secret",
			ExpiresIn:               600,
			Interval:                5,
			PollID:                  "poll-123",
		},
	}
	mux := newTestSSOServer(t, mock)

	body := `{"profile":"my-sso-profile","region":"us-east-1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/start", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp ssoStartHTTPResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.VerificationURI != "https://device.sso.us-east-1.amazonaws.com/" {
		t.Errorf("unexpected verification_uri: %s", resp.VerificationURI)
	}
	if resp.UserCode != "ABCD-EFGH" {
		t.Errorf("unexpected user_code: %s", resp.UserCode)
	}
	if resp.PollID != "poll-123" {
		t.Errorf("unexpected poll_id: %s", resp.PollID)
	}
	if resp.ExpiresIn != 600 {
		t.Errorf("unexpected expires_in: %d", resp.ExpiresIn)
	}
	if resp.Interval != 5 {
		t.Errorf("unexpected interval: %d", resp.Interval)
	}
}

func TestSSOStart_SensitiveFieldsNotExposed(t *testing.T) {
	mock := &mockSSOService{
		startResp: &SSOStartResponse{
			VerificationURI: "https://example.com/",
			UserCode:        "ABCD",
			DeviceCode:      "secret-device-code",
			ClientID:        "secret-client-id",
			ClientSecret:    "secret-client-secret",
			PollID:          "poll-1",
			ExpiresIn:       600,
			Interval:        5,
		},
	}
	mux := newTestSSOServer(t, mock)

	body := `{"profile":"p"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/start", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	// Parse as raw map to check no sensitive keys leak.
	var raw map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for _, key := range []string{"device_code", "client_id", "client_secret"} {
		if _, ok := raw[key]; ok {
			t.Errorf("sensitive field %q MUST NOT appear in HTTP response", key)
		}
	}
}

func TestSSOStart_MissingProfile(t *testing.T) {
	mux := newTestSSOServer(t, &mockSSOService{})

	body := `{"region":"us-east-1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/start", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSSOStart_InvalidJSON(t *testing.T) {
	mux := newTestSSOServer(t, &mockSSOService{})

	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/start", bytes.NewBufferString("{bad"))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSSOStart_EmptyBody(t *testing.T) {
	mux := newTestSSOServer(t, &mockSSOService{})

	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSSOStart_ServiceError(t *testing.T) {
	mock := &mockSSOService{
		startErr: errors.New("AWS SSO OIDC error"),
	}
	mux := newTestSSOServer(t, mock)

	body := `{"profile":"p"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/start", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}

func TestSSOStart_ServiceNotConfigured(t *testing.T) {
	oldSvc := ssoSvcRegistry
	defer func() { ssoSvcRegistry = oldSvc }()
	ssoSvcRegistry = nil

	mux := http.NewServeMux()
	s := &Server{mux: mux}
	s.RegisterSSORoutes()

	body := `{"profile":"p"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/start", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

// ---------- handleSSOPoll tests ----------

func TestSSOPoll_Pending(t *testing.T) {
	mock := &mockSSOService{
		pollResp: &SSOPollResponse{
			Status: "pending",
		},
	}
	mux := newTestSSOServer(t, mock)

	body := `{"poll_id":"poll-123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/poll", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp SSOPollResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != "pending" {
		t.Errorf("expected pending, got %s", resp.Status)
	}
}

func TestSSOPoll_Complete(t *testing.T) {
	mock := &mockSSOService{
		pollResp: &SSOPollResponse{
			Status:   "complete",
			Identity: "arn:aws:iam::123456789012:role/MyRole",
		},
	}
	mux := newTestSSOServer(t, mock)

	body := `{"poll_id":"poll-123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/poll", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp SSOPollResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != "complete" {
		t.Errorf("expected complete, got %s", resp.Status)
	}
	if resp.Identity != "arn:aws:iam::123456789012:role/MyRole" {
		t.Errorf("unexpected identity: %s", resp.Identity)
	}
}

func TestSSOPoll_Expired(t *testing.T) {
	mock := &mockSSOService{
		pollResp: &SSOPollResponse{
			Status: "expired",
			Error:  "device authorization expired",
		},
	}
	mux := newTestSSOServer(t, mock)

	body := `{"poll_id":"poll-expired"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/poll", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp SSOPollResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != "expired" {
		t.Errorf("expected expired, got %s", resp.Status)
	}
}

func TestSSOPoll_MissingPollID(t *testing.T) {
	mux := newTestSSOServer(t, &mockSSOService{})

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/poll", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSSOPoll_InvalidJSON(t *testing.T) {
	mux := newTestSSOServer(t, &mockSSOService{})

	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/poll", bytes.NewBufferString("not-json"))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSSOPoll_ServiceError(t *testing.T) {
	mock := &mockSSOService{
		pollErr: errors.New("internal error"),
	}
	mux := newTestSSOServer(t, mock)

	body := `{"poll_id":"poll-123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/poll", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}

func TestSSOPoll_ServiceNotConfigured(t *testing.T) {
	oldSvc := ssoSvcRegistry
	defer func() { ssoSvcRegistry = oldSvc }()
	ssoSvcRegistry = nil

	mux := http.NewServeMux()
	s := &Server{mux: mux}
	s.RegisterSSORoutes()

	body := `{"poll_id":"poll-123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/config/providers/bedrock/sso/poll", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}
