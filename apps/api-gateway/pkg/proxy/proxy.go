package proxy

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// Config configures the reverse proxy targeting upstream agentic-harness.
type Config struct {
	TargetURL string
}

// ErrorResponse is returned as JSON when proxying fails.
type ErrorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

// NewProxy creates an http.Handler that reverse proxies requests to the target harness URL.
func NewProxy(cfg Config) (http.Handler, error) {
	target, err := url.Parse(cfg.TargetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy target URL %q: %w", cfg.TargetURL, err)
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.Host = target.Host
			// Preserve existing headers, SetURL already handles X-Forwarded headers.
		},
		// Flush immediately so SSE streams (e.g. /interactions/:id/sse) are not buffered.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Error("Proxy upstream error",
				"target", target.String(),
				"path", r.URL.Path,
				"method", r.Method,
				"error", err,
			)

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(ErrorResponse{
				Error:   "Bad Gateway",
				Details: fmt.Sprintf("Failed to communicate with upstream agentic harness: %v", err),
			})
		},
	}

	return proxy, nil
}
