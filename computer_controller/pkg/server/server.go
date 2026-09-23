package server

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/logger"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/services"
)

type responseWriterInterceptor struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriterInterceptor) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriterInterceptor) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func requestLoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriterInterceptor{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)
		duration := time.Since(start)

		logger.Info("HTTP Request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.statusCode,
			"duration", duration.String(),
			"remote_addr", r.RemoteAddr,
		)
	})
}

func apiKeyAuthMiddleware(expectedKey string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		token := strings.TrimPrefix(authHeader, "Bearer ")

		if authHeader == "" || token != expectedKey {
			logger.Warn("Unauthorized access attempt", "remote_addr", r.RemoteAddr, "path", r.URL.Path)
			http.Error(w, "Unauthorized: invalid or missing API key", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func NewServerHandlerAndProvider(server_config *config.ServerConfig) (http.Handler, computer.IComputerProvider, error) {
	if server_config == nil {
		return nil, nil, fmt.Errorf("server_config cannot be nil")
	}

	mux := http.NewServeMux()

	computer_provider, err := computer.GetComputerProvider(server_config)
	if err != nil {
		return nil, nil, err
	}

	services.CreateComputerProviderServiceHandler(mux, computer_provider, server_config.WorkspaceDir)
	services.CreateBasicComputerServiceHandler(mux, computer_provider)
	services.CreateGraphicComputerServiceHandler(mux, computer_provider)

	var handler http.Handler = mux

	if server_config.Server.Security.HasBearerToken() {
		handler = apiKeyAuthMiddleware(server_config.Server.Security.BearerToken, handler)
	}

	handler = requestLoggingMiddleware(handler)

	return handler, computer_provider, nil
}

func NewServerHandler(server_config *config.ServerConfig) (http.Handler, error) {
	handler, _, err := NewServerHandlerAndProvider(server_config)
	if err != nil {
		return nil, err
	}

	return handler, nil
}

func RunServer() {
	server_config, err := config.LoadConfigFromFile()
	if err != nil {
		logger.Fatal("unable to load computer.yaml", "error", err)
	}

	logger.Init(server_config.Logging.Level, server_config.Logging.Format, os.Stdout)
	logger.Info("Starting Computer Controller Service...", "address", server_config.Server.Address(), "type", server_config.Type)

	handler, _, err := NewServerHandlerAndProvider(server_config)
	if err != nil {
		logger.Fatal("unable to create computer provider", "error", err)
	}

	server := http.Server{
		Addr:    server_config.Server.Address(),
		Handler: handler,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigCh
		logger.Info("Received termination signal, shutting down server...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("error shutting down server", "error", err)
		}
	}()

	// handle TLS
	if server_config.Server.Security.HasTLS() {
		tlsConfig := &tls.Config{
			MinVersion: tls.VersionTLS12,
		}

		if server_config.Server.Security.HasMTLS() {
			caFilePath := server_config.Server.Security.Tls.TlsTrustedCertificates
			caBytes, err := os.ReadFile(caFilePath)
			if err != nil {
				logger.Fatal("failed to read ca cert", "path", caFilePath, "error", err)
			}

			ca := x509.NewCertPool()
			if ok := ca.AppendCertsFromPEM(caBytes); !ok {
				logger.Fatal("failed to parse ca cert", "path", caFilePath)
			}

			tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
			tlsConfig.ClientCAs = ca
		}

		server.TLSConfig = tlsConfig

		logger.Info("Listening on TLS", "address", server_config.Server.Address())
		if err := server.ListenAndServeTLS(
			server_config.Server.Security.Tls.TlsCertificate,
			server_config.Server.Security.Tls.TlsCertificateKey,
		); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("failed to start TLS server", "error", err)
		}
	} else {
		protocols := new(http.Protocols)
		protocols.SetHTTP1(true)
		protocols.SetUnencryptedHTTP2(true)
		server.Protocols = protocols

		logger.Info("Listening on HTTP/h2c", "address", server_config.Server.Address())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("failed to start HTTP server", "error", err)
		}
	}
}
