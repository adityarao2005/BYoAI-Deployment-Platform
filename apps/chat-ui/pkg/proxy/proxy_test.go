package proxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/chat_ui/pkg/auth"
	"github.com/gorilla/sessions"
)

type mockSessionStore struct {
	session *auth.Session
}

func (m *mockSessionStore) Get(r *http.Request) (*auth.Session, error) {
	return m.session, nil
}

func TestHarnessProxy_ForwardAndInjectToken(t *testing.T) {
	var receivedAuthHeader string
	var receivedPath string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuthHeader = r.Header.Get("Authorization")
		receivedPath = r.URL.Path

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer upstream.Close()

	sess := sessions.NewSession(&sessions.CookieStore{}, "chat_session")
	sess.Values["access_token"] = "mock-jwt-token-123"

	store := &mockSessionStore{session: &auth.Session{Session: sess}}

	proxyHandler, err := NewHarnessProxy(Config{
		TargetURL:    upstream.URL,
		SessionStore: store,
	})
	if err != nil {
		t.Fatalf("Failed to create proxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/interactions/456", nil)
	w := httptest.NewRecorder()

	proxyHandler.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	if receivedPath != "/interactions/456" {
		t.Errorf("Expected path /interactions/456, got %s", receivedPath)
	}

	if receivedAuthHeader != "Bearer mock-jwt-token-123" {
		t.Errorf("Expected auth header 'Bearer mock-jwt-token-123', got %s", receivedAuthHeader)
	}
}

func TestHarnessProxy_UpstreamError(t *testing.T) {
	proxyHandler, err := NewHarnessProxy(Config{
		TargetURL: "http://127.0.0.1:54321",
	})
	if err != nil {
		t.Fatalf("Failed to create proxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/interactions", nil)
	w := httptest.NewRecorder()

	proxyHandler.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("Expected status 502, got %d", resp.StatusCode)
	}

	var errResp ErrorResponse
	if err := json.NewDecoder(resp.Body).Decode(&errResp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if errResp.Error != "Bad Gateway" {
		t.Errorf("Expected 'Bad Gateway', got %s", errResp.Error)
	}
}
