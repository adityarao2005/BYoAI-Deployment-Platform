package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"

	"golang.org/x/oauth2"
)

// OAuthManager handles OAuth2 Authorization Code flow with PKCE.
type OAuthManager struct {
	Config        *oauth2.Config
	CallbackPath  string
	IssuerURI     string
}

// NewOAuthManager creates a new OAuthManager from config values.
// The redirect URL is set dynamically per-request, so we leave it empty here.
func NewOAuthManager(issuerURI, clientID, clientSecret, callbackPath string) *OAuthManager {
	oauthCfg := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Scopes:       []string{"openid", "profile", "email"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  issuerURI + "/authorize",
			TokenURL: issuerURI + "/token",
		},
	}

	return &OAuthManager{
		Config:       oauthCfg,
		CallbackPath: callbackPath,
		IssuerURI:    issuerURI,
	}
}

// BuildRedirectURI dynamically constructs the full redirect URI from the incoming request.
// This inspects X-Forwarded-Proto, X-Forwarded-Host, r.TLS, and r.Host to determine
// the externally-visible scheme and host, then appends the configured callback path.
func BuildRedirectURI(r *http.Request, callbackPath string) string {
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}

	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}

	return fmt.Sprintf("%s://%s%s", scheme, host, callbackPath)
}

// GenerateState creates a cryptographically random state parameter.
func GenerateState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate random state: %w", err)
	}
	return base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(b), nil
}

// HandleLogin initiates the OAuth2 Authorization Code flow.
// It generates PKCE parameters, stores state and verifier in the session,
// and redirects the user to the authorization server.
func (m *OAuthManager) HandleLogin(sessionStore SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state, err := GenerateState()
		if err != nil {
			slog.Error("Failed to generate OAuth state", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Generate PKCE verifier
		verifier := oauth2.GenerateVerifier()

		// Store state and verifier in session
		session, err := sessionStore.Get(r)
		if err != nil {
			slog.Error("Failed to get session", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		session.Values["oauth_state"] = state
		session.Values["oauth_verifier"] = verifier
		if err := session.Save(r, w); err != nil {
			slog.Error("Failed to save session", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		redirectURI := BuildRedirectURI(r, m.CallbackPath)

		// Build authorization URL with PKCE
		cfg := *m.Config
		cfg.RedirectURL = redirectURI

		authURL := cfg.AuthCodeURL(
			state,
			oauth2.S256ChallengeOption(verifier),
		)

		http.Redirect(w, r, authURL, http.StatusFound)
	}
}

// HandleCallback processes the OAuth2 callback, exchanges the authorization code
// for tokens, and stores them in the encrypted session.
func (m *OAuthManager) HandleCallback(sessionStore SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := sessionStore.Get(r)
		if err != nil {
			slog.Error("Failed to get session", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Validate state
		expectedState, _ := session.Values["oauth_state"].(string)
		actualState := r.URL.Query().Get("state")
		if expectedState == "" || actualState != expectedState {
			http.Error(w, "Invalid state parameter", http.StatusBadRequest)
			return
		}

		// Check for error from auth server
		if errCode := r.URL.Query().Get("error"); errCode != "" {
			errDesc := r.URL.Query().Get("error_description")
			slog.Error("OAuth authorization error", "error", errCode, "description", errDesc)
			http.Error(w, fmt.Sprintf("Authorization error: %s", errCode), http.StatusBadRequest)
			return
		}

		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "Missing authorization code", http.StatusBadRequest)
			return
		}

		// Retrieve PKCE verifier from session
		verifier, _ := session.Values["oauth_verifier"].(string)
		if verifier == "" {
			http.Error(w, "Missing PKCE verifier in session", http.StatusBadRequest)
			return
		}

		// Exchange code for tokens
		redirectURI := BuildRedirectURI(r, m.CallbackPath)
		cfg := *m.Config
		cfg.RedirectURL = redirectURI

		token, err := cfg.Exchange(r.Context(), code, oauth2.VerifierOption(verifier))
		if err != nil {
			slog.Error("Token exchange failed", "error", err)
			http.Error(w, "Failed to exchange authorization code", http.StatusInternalServerError)
			return
		}

		// Store tokens in session
		session.Values["access_token"] = token.AccessToken
		session.Values["refresh_token"] = token.RefreshToken
		session.Values["token_type"] = token.TokenType
		if !token.Expiry.IsZero() {
			session.Values["token_expiry"] = token.Expiry.Unix()
		}

		// Extract ID token if present
		idToken, ok := token.Extra("id_token").(string)
		if ok && idToken != "" {
			session.Values["id_token"] = idToken
		}

		// Clean up OAuth flow state
		delete(session.Values, "oauth_state")
		delete(session.Values, "oauth_verifier")

		if err := session.Save(r, w); err != nil {
			slog.Error("Failed to save session after token exchange", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Redirect to the app
		http.Redirect(w, r, "/", http.StatusFound)
	}
}

// HandleLogout clears the session and redirects to the home page.
func HandleLogout(sessionStore SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := sessionStore.Get(r)
		if err != nil {
			slog.Error("Failed to get session for logout", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Clear all session values
		for key := range session.Values {
			delete(session.Values, key)
		}

		session.Options.MaxAge = -1 // Delete the cookie
		if err := session.Save(r, w); err != nil {
			slog.Error("Failed to save session on logout", "error", err)
		}

		http.Redirect(w, r, "/", http.StatusFound)
	}
}

// HandleMe returns the current user's profile information from the session.
func HandleMe(sessionStore SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := sessionStore.Get(r)
		if err != nil {
			http.Error(w, `{"authenticated":false}`, http.StatusOK)
			return
		}

		accessToken, _ := session.Values["access_token"].(string)
		if accessToken == "" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"authenticated":false}`))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"authenticated":true}`))
	}
}
