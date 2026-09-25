package auth

import (
	"log/slog"
	"net/http"
	"strings"
)

// RequireAuth is middleware that checks for a valid session with an access token.
// If not authenticated, API requests get 401; page requests get redirected to /auth/login.
func RequireAuth(sessionStore SessionStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, err := sessionStore.Get(r)
			if err != nil {
				slog.Debug("Session retrieval failed", "error", err, "path", r.URL.Path)
				handleUnauthenticated(w, r)
				return
			}

			accessToken, _ := session.Values["access_token"].(string)
			if accessToken == "" {
				handleUnauthenticated(w, r)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// AccessTokenFromSession extracts the access token from the session.
func AccessTokenFromSession(sessionStore SessionStore, r *http.Request) (string, error) {
	session, err := sessionStore.Get(r)
	if err != nil {
		return "", err
	}
	token, _ := session.Values["access_token"].(string)
	return token, nil
}

// handleUnauthenticated responds appropriately based on whether the request is an API call or page navigation.
func handleUnauthenticated(w http.ResponseWriter, r *http.Request) {
	if isAPIRequest(r) {
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"error":"unauthorized","message":"authentication required"}`, http.StatusUnauthorized)
	} else {
		http.Redirect(w, r, "/auth/login", http.StatusFound)
	}
}

// isAPIRequest checks if the request is an API call (vs a page navigation).
func isAPIRequest(r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		return true
	}
	accept := r.Header.Get("Accept")
	return strings.Contains(accept, "application/json")
}
