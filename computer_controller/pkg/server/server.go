package server

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/computer"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/services"
)

func NewServerHandler(server_config *config.ServerConfig) (http.Handler, error) {
	if server_config == nil {
		return nil, fmt.Errorf("server_config cannot be nil")
	}

	mux := http.NewServeMux()

	computer_provider, err := computer.GetComputerProvider(server_config)
	if err != nil {
		return nil, err
	}

	services.CreateComputerProviderServiceHandler(mux, computer_provider)
	services.CreateBasicComputerServiceHandler(mux, computer_provider)
	services.CreateGraphicComputerServiceHandler(mux, computer_provider)

	var handler http.Handler = mux

	if server_config.Server.Security.HasAPIKey() {
		handler = apiKeyAuthMiddleware(server_config.Server.Security.ApiKey, handler)
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

	handler, err := NewServerHandler(server_config)
	if err != nil {
		log.Fatalf("unable to create computer provider: %v", err)
	}

	server := http.Server{
		Addr:    server_config.Server.Address(),
		Handler: handler,
	}

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
		); err != nil {
			log.Fatalf("failed to start TLS server: %v", err)
		}
	} else {
		// Non-TLS: Enable HTTP/1.1 and unencrypted HTTP/2 (h2c)
		protocols := new(http.Protocols)
		protocols.SetHTTP1(true)
		protocols.SetUnencryptedHTTP2(true)
		server.Protocols = protocols

		if err := server.ListenAndServe(); err != nil {
			log.Fatalf("failed to start HTTP server: %v", err)
		}
	}
}
