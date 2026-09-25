package auth

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBuildRedirectURI_PlainHTTP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/login", nil)
	req.Host = "localhost:8081"

	uri := BuildRedirectURI(req, "/auth/callback")
	expected := "http://localhost:8081/auth/callback"
	if uri != expected {
		t.Errorf("expected '%s', got '%s'", expected, uri)
	}
}

func TestBuildRedirectURI_XForwardedProto(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/login", nil)
	req.Host = "app.example.com"
	req.Header.Set("X-Forwarded-Proto", "https")

	uri := BuildRedirectURI(req, "/auth/callback")
	expected := "https://app.example.com/auth/callback"
	if uri != expected {
		t.Errorf("expected '%s', got '%s'", expected, uri)
	}
}

func TestBuildRedirectURI_XForwardedHost(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/login", nil)
	req.Host = "internal-service:8081"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "public.example.com")

	uri := BuildRedirectURI(req, "/custom/callback")
	expected := "https://public.example.com/custom/callback"
	if uri != expected {
		t.Errorf("expected '%s', got '%s'", expected, uri)
	}
}

func TestBuildRedirectURI_TLS(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/login", nil)
	req.Host = "secure.example.com"
	req.TLS = &tls.ConnectionState{} // non-nil TLS indicates HTTPS

	uri := BuildRedirectURI(req, "/auth/callback")
	expected := "https://secure.example.com/auth/callback"
	if uri != expected {
		t.Errorf("expected '%s', got '%s'", expected, uri)
	}
}

func TestGenerateState(t *testing.T) {
	state1, err := GenerateState()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state1 == "" {
		t.Fatal("expected non-empty state")
	}
	if len(state1) < 20 {
		t.Errorf("state too short: %s", state1)
	}

	// States should be unique
	state2, err := GenerateState()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state1 == state2 {
		t.Error("expected unique states, got identical values")
	}
}

func TestRequireAuth_Unauthenticated_APIRequest(t *testing.T) {
	store := NewCookieSessionStore("test-secret-key-32bytes-long!!!")

	mw := RequireAuth(store)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for unauthenticated API requests")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/interactions", nil)
	req.Header.Set("Accept", "application/json")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestRequireAuth_Unauthenticated_PageRequest(t *testing.T) {
	store := NewCookieSessionStore("test-secret-key-32bytes-long!!!")

	mw := RequireAuth(store)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for unauthenticated page requests")
	}))

	req := httptest.NewRequest(http.MethodGet, "/dashboard", nil)
	req.Header.Set("Accept", "text/html")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Errorf("expected 302 redirect, got %d", rr.Code)
	}
	location := rr.Header().Get("Location")
	if location != "/auth/login" {
		t.Errorf("expected redirect to /auth/login, got '%s'", location)
	}
}

func TestHandleMe_Unauthenticated(t *testing.T) {
	store := NewCookieSessionStore("test-secret-key-32bytes-long!!!")

	handler := HandleMe(store)

	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body != `{"authenticated":false}` {
		t.Errorf("unexpected body: %s", body)
	}
}

func TestHandleLogout(t *testing.T) {
	store := NewCookieSessionStore("test-secret-key-32bytes-long!!!")

	handler := HandleLogout(store)

	req := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Errorf("expected 302, got %d", rr.Code)
	}
}

func TestOAuthManager_HandleLogin_Redirect(t *testing.T) {
	mgr := NewOAuthManager(
		"https://idp.example.com",
		"test-client-id",
		"test-client-secret",
		"/auth/callback",
	)

	store := NewCookieSessionStore("test-secret-key-32bytes-long!!!")
	handler := mgr.HandleLogin(store)

	req := httptest.NewRequest(http.MethodGet, "/auth/login", nil)
	req.Host = "localhost:8081"
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Errorf("expected 302, got %d", rr.Code)
	}

	location := rr.Header().Get("Location")
	if location == "" {
		t.Fatal("expected Location header")
	}

	// Should redirect to the IDP authorize endpoint
	if !contains(location, "idp.example.com/authorize") {
		t.Errorf("expected redirect to IDP authorize, got: %s", location)
	}
	// Should contain PKCE code_challenge
	if !contains(location, "code_challenge=") {
		t.Errorf("expected code_challenge in redirect URL, got: %s", location)
	}
	// Should contain redirect_uri
	if !contains(location, "redirect_uri=") {
		t.Errorf("expected redirect_uri in redirect URL, got: %s", location)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
