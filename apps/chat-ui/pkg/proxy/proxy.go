package proxy

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/chat_ui/pkg/auth"
)

// Config configures the Chat UI reverse proxy targeting agentic-harness.
type Config struct {
	TargetURL    string
	SessionStore auth.SessionStore
}

// ErrorResponse is returned as JSON when proxying fails.
type ErrorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

// NewHarnessProxy creates an http.Handler that proxies /api/* requests to agentic-harness /* endpoints.
func NewHarnessProxy(cfg Config) (http.Handler, error) {
	target, err := url.Parse(cfg.TargetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid harness target URL %q: %w", cfg.TargetURL, err)
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.Host = target.Host

			// Strip /api prefix if present (e.g. /api/interactions -> /interactions)
			if strings.HasPrefix(r.Out.URL.Path, "/api") {
				r.Out.URL.Path = strings.TrimPrefix(r.Out.URL.Path, "/api")
				if !strings.HasPrefix(r.Out.URL.Path, "/") {
					r.Out.URL.Path = "/" + r.Out.URL.Path
				}
			}

			// Inject access token from session if available
			if cfg.SessionStore != nil {
				token, err := auth.AccessTokenFromSession(cfg.SessionStore, r.In)
				if err == nil && token != "" {
					r.Out.Header.Set("Authorization", "Bearer "+token)
				}
			}
		},
		FlushInterval: -1, // Enable unbuffered streaming for SSE
		ModifyResponse: func(resp *http.Response) error {
			if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
				resp.Header.Set("X-Accel-Buffering", "no")
				resp.Header.Set("Cache-Control", "no-cache, no-transform")
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Error("Chat UI proxy upstream error",
				"target", target.String(),
				"path", r.URL.Path,
				"method", r.Method,
				"error", err,
			)

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(ErrorResponse{
				Error:   "Bad Gateway",
				Details: fmt.Sprintf("Failed to communicate with agentic harness: %v", err),
			})
		},
	}

	return proxy, nil
}
