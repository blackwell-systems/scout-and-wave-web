package api

import (
	"context"
	"net/http"
)

// SSOService abstracts the SSO device-auth service layer so that handlers
// can be tested without a real AWS backend.  Agent A implements the concrete
// functions in pkg/service/sso_service.go; wave-2 integration wires the
// concrete implementation into Server via SetSSOService.
type SSOService interface {
	StartSSODeviceAuth(ctx context.Context, req SSOStartRequest) (*SSOStartResponse, error)
	PollSSODeviceAuth(ctx context.Context, req SSOPollRequest) (*SSOPollResponse, error)
}

// ssoSvcRegistry is a package-level holder so handlers can access the SSO
// service without requiring a new field on Server (which is owned by another
// agent).  Wave 2 integration calls SetSSOService during server setup.
var ssoSvcRegistry SSOService

// SetSSOService wires the SSO service implementation into the HTTP handlers.
// Must be called before RegisterSSORoutes.
func SetSSOService(svc SSOService) {
	ssoSvcRegistry = svc
}

// SSOStartRequest is the JSON body for the SSO start endpoint.
type SSOStartRequest struct {
	Profile string `json:"profile"`
	Region  string `json:"region,omitempty"`
}

// SSOStartResponse is returned by the service layer.  It contains sensitive
// fields (DeviceCode, ClientID, ClientSecret) that MUST NOT be sent to the
// browser -- see ssoStartHTTPResponse.
type SSOStartResponse struct {
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	UserCode                string `json:"user_code"`
	DeviceCode              string `json:"device_code"`
	ClientID                string `json:"client_id"`
	ClientSecret            string `json:"client_secret"`
	ExpiresIn               int32  `json:"expires_in"`
	Interval                int32  `json:"interval"`
	PollID                  string `json:"poll_id"`
}

// SSOPollRequest is the JSON body for the SSO poll endpoint.
type SSOPollRequest struct {
	PollID string `json:"poll_id"`
}

// SSOPollResponse is returned by the service layer for polling status.
type SSOPollResponse struct {
	Status   string `json:"status"`
	Identity string `json:"identity,omitempty"`
	Error    string `json:"error,omitempty"`
}

// ssoStartHTTPResponse is the sanitised response sent to the browser.
// CRITICAL: device_code, client_id, and client_secret are intentionally
// excluded to prevent leaking secrets to the frontend.
type ssoStartHTTPResponse struct {
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	UserCode                string `json:"user_code"`
	PollID                  string `json:"poll_id"`
	ExpiresIn               int32  `json:"expires_in"`
	Interval                int32  `json:"interval"`
}

// handleSSOStart handles POST /api/config/providers/bedrock/sso/start.
// Decodes the request, calls the SSO service, and returns a sanitised
// response that omits sensitive fields.
func (s *Server) handleSSOStart(w http.ResponseWriter, r *http.Request) {
	var req SSOStartRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Profile == "" {
		respondError(w, "profile is required", http.StatusBadRequest)
		return
	}

	if ssoSvcRegistry == nil {
		respondError(w, "SSO service not configured", http.StatusServiceUnavailable)
		return
	}

	resp, err := ssoSvcRegistry.StartSSODeviceAuth(r.Context(), req)
	if err != nil {
		respondError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	httpResp := ssoStartHTTPResponse{
		VerificationURI:         resp.VerificationURI,
		VerificationURIComplete: resp.VerificationURIComplete,
		UserCode:                resp.UserCode,
		PollID:                  resp.PollID,
		ExpiresIn:               resp.ExpiresIn,
		Interval:                resp.Interval,
	}

	respondJSON(w, http.StatusOK, httpResp)
}

// handleSSOPoll handles POST /api/config/providers/bedrock/sso/poll.
// Returns the current status of an in-progress device authorization flow.
func (s *Server) handleSSOPoll(w http.ResponseWriter, r *http.Request) {
	var req SSOPollRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.PollID == "" {
		respondError(w, "poll_id is required", http.StatusBadRequest)
		return
	}

	if ssoSvcRegistry == nil {
		respondError(w, "SSO service not configured", http.StatusServiceUnavailable)
		return
	}

	resp, err := ssoSvcRegistry.PollSSODeviceAuth(r.Context(), req)
	if err != nil {
		respondError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	respondJSON(w, http.StatusOK, resp)
}

// RegisterSSORoutes registers SSO device-auth HTTP routes on the server mux.
func (s *Server) RegisterSSORoutes() {
	s.mux.HandleFunc("POST /api/config/providers/bedrock/sso/start", s.handleSSOStart)
	s.mux.HandleFunc("POST /api/config/providers/bedrock/sso/poll", s.handleSSOPoll)
}
