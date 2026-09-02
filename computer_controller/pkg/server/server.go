package server

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/services"
)

func NewServerHandlerAndProvider(server_config *config.ServerConfig) (http.Handler, computer.IComputerProvider, error) {
	if server_config == nil {
		return nil, nil, fmt.Errorf("server_config cannot be nil")
	}

	mux := http.NewServeMux()

	computer_provider, err := computer.GetComputerProvider(server_config)
	if err != nil {
		return nil, nil, err
	}

	services.CreateComputerProviderServiceHandler(mux, computer_provider)
	services.CreateBasicComputerServiceHandler(mux, computer_provider)
	services.CreateGraphicComputerServiceHandler(mux, computer_provider)

	var handler http.Handler = mux

	if server_config.Server.Security.HasAPIKey() {
		handler = apiKeyAuthMiddleware(server_config.Server.Security.ApiKey, handler)
	}

	return handler, computer_provider, nil
}

func NewServerHandler(server_config *config.ServerConfig) (http.Handler, error) {
	handler, provider, err := NewServerHandlerAndProvider(server_config)
	if err != nil {
		return nil, err
	}

	if reaper, ok := provider.(*computer.ReaperProvider); ok {
		reaper.Start(context.Background())
	}

	return handler, nil
}

func apiKeyAuthMiddleware(expectedKey string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		token := strings.TrimPrefix(authHeader, "Bearer ")

		if authHeader == "" || token != expectedKey {
			http.Error(w, "Unauthorized: invalid or missing API key", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func RunServer() {
	server_config, err := config.LoadConfigFromFile()
	if err != nil {
		log.Fatalf("unable to load computer.yaml: %v", err)
	}

	handler, computerProvider, err := NewServerHandlerAndProvider(server_config)
	if err != nil {
		log.Fatalf("unable to create computer provider: %v", err)
	}

	if reaper, ok := computerProvider.(*computer.ReaperProvider); ok {
		reaper.Start(context.Background())
	}

	server := http.Server{
		Addr:    server_config.Server.Address(),
		Handler: handler,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigCh
		log.Println("Received termination signal, shutting down server...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if reaper, ok := computerProvider.(*computer.ReaperProvider); ok {
			if err := reaper.Stop(shutdownCtx); err != nil {
				log.Printf("error stopping reaper during shutdown: %v", err)
			}
		}

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("error shutting down server: %v", err)
		}
	}()

	// handle TLS
	if server_config.Server.Security.HasTLS() {
		// handle TLS
		tlsConfig := &tls.Config{
			MinVersion: tls.VersionTLS12,
		}

		// if mTLS add client auth and client CAs
		if server_config.Server.Security.HasMTLS() {
			caFilePath := server_config.Server.Security.Tls.TlsTrustedCertificates
			caBytes, err := os.ReadFile(caFilePath)
			if err != nil {
				log.Fatalf("failed to read ca cert %q: %v", caFilePath, err)
			}

			ca := x509.NewCertPool()
			if ok := ca.AppendCertsFromPEM(caBytes); !ok {
				log.Fatalf("failed to parse ca cert %q", caFilePath)
			}

			tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
			tlsConfig.ClientCAs = ca
		}

		server.TLSConfig = tlsConfig

		if err := server.ListenAndServeTLS(
			server_config.Server.Security.Tls.TlsCertificate,
			server_config.Server.Security.Tls.TlsCertificateKey,
		); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("failed to start TLS server: %v", err)
		}
	} else {
		// Non-TLS: Enable HTTP/1.1 and unencrypted HTTP/2 (h2c)
		protocols := new(http.Protocols)
		protocols.SetHTTP1(true)
		protocols.SetUnencryptedHTTP2(true)
		server.Protocols = protocols

		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("failed to start HTTP server: %v", err)
		}
	}
}
