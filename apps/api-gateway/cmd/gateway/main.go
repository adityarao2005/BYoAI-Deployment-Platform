package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/api_gateway/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/api_gateway/pkg/middleware"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/api_gateway/pkg/proxy"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		slog.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	var logLevel slog.Level
	switch cfg.LogLevel {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	slog.Info("Starting API Gateway",
		"listen_addr", cfg.ListenAddr,
		"agent_harness_uri", cfg.AgentHarnessURI,
		"jwks_uri", cfg.JWKSURI,
	)

	// Create reverse proxy to agentic-harness
	proxyHandler, err := proxy.NewProxy(proxy.Config{
		TargetURL: cfg.AgentHarnessURI,
	})
	if err != nil {
		slog.Error("Failed to initialize reverse proxy", "error", err)
		os.Exit(1)
	}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)

	// CORS middleware
	r.Use(middleware.NewCORSMiddleware(middleware.DefaultCORSConfig()))

	// Health check endpoint (no JWT required)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","app":"api-gateway"}`))
	})

	// JWT middleware — applied when JWKS_URI is configured
	if cfg.JWKSURI != "" {
		jwks, err := keyfunc.NewDefault([]string{cfg.JWKSURI})
		if err != nil {
			slog.Error("Failed to create JWKS keyfunc", "error", err, "jwks_uri", cfg.JWKSURI)
			os.Exit(1)
		}

		jwtMW := middleware.NewJWTMiddleware(middleware.JWTMiddlewareConfig{
			JWKS:     jwks,
			Issuer:   cfg.JWTIssuer,
			Audience: cfg.JWTAudience,
		})

		// Protected proxy group
		r.Group(func(r chi.Router) {
			r.Use(jwtMW)
			r.Handle("/*", proxyHandler)
		})

		slog.Info("JWT middleware enabled", "jwks_uri", cfg.JWKSURI, "issuer", cfg.JWTIssuer, "audience", cfg.JWTAudience)
	} else {
		slog.Warn("JWKS_URI not configured — JWT validation is DISABLED. All requests will pass through without authentication.")
		r.Handle("/*", proxyHandler)
	}

	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	slog.Info("API Gateway is listening", "addr", cfg.ListenAddr)
	<-sigChan
	slog.Info("Shutting down API Gateway...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("Server forced to shutdown", "error", err)
	}

	slog.Info("API Gateway stopped gracefully")
}
