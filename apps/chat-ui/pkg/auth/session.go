package auth

import (
	"net/http"

	"github.com/gorilla/sessions"
)

const sessionName = "byoai-session"

// Session wraps gorilla/sessions.Session to provide a clean interface.
type Session struct {
	*sessions.Session
}

// SessionStore provides session management using encrypted cookies.
type SessionStore interface {
	Get(r *http.Request) (*Session, error)
}

// CookieSessionStore implements SessionStore using gorilla/sessions.CookieStore.
type CookieSessionStore struct {
	store *sessions.CookieStore
}

// NewCookieSessionStore creates a new encrypted cookie session store.
func NewCookieSessionStore(secret string) *CookieSessionStore {
	store := sessions.NewCookieStore([]byte(secret))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7, // 7 days
		HttpOnly: true,
		Secure:   false, // set true in production behind TLS
		SameSite: http.SameSiteLaxMode,
	}
	return &CookieSessionStore{store: store}
}

// Get retrieves the session for the current request.
func (s *CookieSessionStore) Get(r *http.Request) (*Session, error) {
	sess, err := s.store.Get(r, sessionName)
	if err != nil {
		return nil, err
	}
	return &Session{Session: sess}, nil
}
