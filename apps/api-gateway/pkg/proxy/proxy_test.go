package proxy

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProxy_ForwardRequest(t *testing.T) {
	// Upstream test server simulating agentic-harness
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "Bearer test-jwt-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		if r.URL.Path == "/interactions" && r.Method == http.MethodPost {
			body, _ := io.ReadAll(r.Body)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"interaction-123","received":` + string(body) + `}`))
			return
		}

		http.NotFound(w, r)
	}))
	defer upstream.Close()

	proxyHandler, err := NewProxy(Config{TargetURL: upstream.URL})
	if err != nil {
		t.Fatalf("Failed to create proxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/interactions", io.NopCloser(httptest.NewRequest(http.MethodPost, "/", nil).Body))
	req.Header.Set("Authorization", "Bearer test-jwt-token")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	proxyHandler.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
}

func TestProxy_BadGatewayError(t *testing.T) {
	// Target URL where no server is listening
	proxyHandler, err := NewProxy(Config{TargetURL: "http://127.0.0.1:54321"})
	if err != nil {
		t.Fatalf("Failed to create proxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/interactions/test", nil)
	w := httptest.NewRecorder()

	proxyHandler.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("Expected status 502, got %d", resp.StatusCode)
	}

	var errResp ErrorResponse
	if err := json.NewDecoder(resp.Body).Decode(&errResp); err != nil {
		t.Fatalf("Failed to decode error response: %v", err)
	}
	if errResp.Error != "Bad Gateway" {
		t.Errorf("Expected error 'Bad Gateway', got %q", errResp.Error)
	}
}

func TestProxy_InvalidTargetURL(t *testing.T) {
	_, err := NewProxy(Config{TargetURL: "::invalid-url::"})
	if err == nil {
		t.Errorf("Expected error for invalid target URL, got nil")
	}
}
