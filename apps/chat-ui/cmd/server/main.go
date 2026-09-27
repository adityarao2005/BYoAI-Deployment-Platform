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

	chatui "github.com/adityarao2005/BYoAI-Deployment-Platform/chat_ui"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/chat_ui/pkg/auth"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/chat_ui/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/chat_ui/pkg/proxy"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/chat_ui/pkg/server"
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

	slog.Info("Starting Chat UI Server",
		"listen_addr", cfg.ListenAddr,
		"agent_harness_uri", cfg.AgentHarnessURI,
		"oauth_issuer_uri", cfg.OAuthIssuerURI,
	)

	// Initialize session store
	sessionStore := auth.NewCookieSessionStore(cfg.SessionSecret)

	// Initialize OAuth manager
	oauthMgr := auth.NewOAuthManager(
		cfg.OAuthIssuerURI,
		cfg.OAuthClientID,
		cfg.OAuthClientSecret,
		cfg.OAuthCallbackPath,
	)

	// Initialize harness proxy
	harnessProxy, err := proxy.NewHarnessProxy(proxy.Config{
		TargetURL:    cfg.AgentHarnessURI,
		SessionStore: sessionStore,
	})
	if err != nil {
		slog.Error("Failed to create harness proxy", "error", err)
		os.Exit(1)
	}

	// Initialize SPA static handler
	distFS, err := chatui.DistFS()
	if err != nil {
		slog.Error("Failed to initialize static dist FS", "error", err)
		os.Exit(1)
	}
	spaHandler := server.NewSPAHandler(distFS, "index.html")

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)

	// Health endpoint (no auth required)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","app":"chat-ui"}`))
	})

	// Auth routes (no auth required)
	r.Route("/auth", func(r chi.Router) {
		r.Get("/login", oauthMgr.HandleLogin(sessionStore))
		r.Get("/callback", oauthMgr.HandleCallback(sessionStore))
		r.Post("/logout", auth.HandleLogout(sessionStore))
		r.Get("/me", auth.HandleMe(sessionStore))
	})

	// Protected routes (require valid OAuth session)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(sessionStore))
		r.Handle("/api/*", harnessProxy)
		r.Handle("/*", spaHandler)
	})

	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	slog.Info("Chat UI Server is listening", "addr", cfg.ListenAddr)
	<-sigChan
	slog.Info("Shutting down Chat UI Server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("Server forced to shutdown", "error", err)
	}

	slog.Info("Chat UI Server stopped gracefully")
}
