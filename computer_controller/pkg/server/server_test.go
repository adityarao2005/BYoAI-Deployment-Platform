package server_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	computer_apiv1 "github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/gen/computer_api/v1/computer_apiv1connect"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/server"
)

func TestNewServerHandler(t *testing.T) {
	t.Run("Nil config returns error", func(t *testing.T) {
		handler, err := server.NewServerHandler(nil)
		if err == nil {
			t.Fatal("expected error for nil config, got nil")
		}
		if handler != nil {
			t.Fatalf("expected nil handler, got %v", handler)
		}
	})

	t.Run("Valid local config returns handler", func(t *testing.T) {
		cfg := &config.ServerConfig{
			Type: config.TypeLocal,
		}
		handler, err := server.NewServerHandler(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if handler == nil {
			t.Fatal("expected non-nil handler")
		}
	})
}

func TestServerConnectRPCIntegration(t *testing.T) {
	cfg := &config.ServerConfig{
		Type: config.TypeLocal,
	}

	handler, err := server.NewServerHandler(cfg)
	if err != nil {
		t.Fatalf("failed to create server handler: %v", err)
	}

	ts := httptest.NewServer(handler)
	defer ts.Close()

	ctx := context.Background()

	providerClient := computer_apiv1connect.NewComputerProviderServiceClient(
		ts.Client(),
		ts.URL,
	)

	basicClient := computer_apiv1connect.NewBasicComputerServiceClient(
		ts.Client(),
		ts.URL,
	)

	t.Run("ComputerProviderService - Create, GetInfo, Delete", func(t *testing.T) {
		// 1. Create Computer
		createResp, err := providerClient.CreateComputer(ctx, connect.NewRequest(&computer_apiv1.CreateComputerRequest{
			Image: "ubuntu:latest",
		}))
		if err != nil {
			t.Fatalf("CreateComputer RPC failed: %v", err)
		}
		sessionID := createResp.Msg.GetSessionId()
		if sessionID == "" {
			t.Fatalf("expected non-empty sessionId, got error: %v", createResp.Msg.GetErrorMessage())
		}

		// 2. Get Computer Info
		infoResp, err := providerClient.GetComputerInfo(ctx, connect.NewRequest(&computer_apiv1.GetComputerInfoRequest{
			SessionId: sessionID,
		}))
		if err != nil {
			t.Fatalf("GetComputerInfo RPC failed: %v", err)
		}
		if infoResp.Msg.GetType() == computer_apiv1.ComputerType_COMPUTER_TYPE_UNSPECIFIED {
			t.Errorf("expected valid computer type, got UNSPECIFIED")
		}

		// 3. Delete Computer
		deleteResp, err := providerClient.DeleteComputer(ctx, connect.NewRequest(&computer_apiv1.DeleteComputerRequest{
			SessionId: sessionID,
		}))
		if err != nil {
			t.Fatalf("DeleteComputer RPC failed: %v", err)
		}
		if deleteResp == nil {
			t.Fatal("expected non-nil DeleteComputerResponse")
		}
	})

	t.Run("BasicComputerService - Execute RPCs", func(t *testing.T) {
		sessionID := "0"

		// Standard command execution
		t.Run("Stdout and zero exit code", func(t *testing.T) {
			execResp, err := basicClient.Execute(ctx, connect.NewRequest(&computer_apiv1.ExecuteRequest{
				SessionId: sessionID,
				Command:   "echo hello_network",
			}))
			if err != nil {
				t.Fatalf("Execute RPC failed: %v", err)
			}
			execResult := execResp.Msg.GetExecResult()
			if execResult == nil {
				t.Fatalf("expected ExecResult, got error: %v", execResp.Msg.GetErrorMessage())
			}
			if execResult.ExitCode != 0 {
				t.Errorf("expected exit code 0, got %d", execResult.ExitCode)
			}
			if execResult.Stdout != "hello_network\n" {
				t.Errorf("expected stdout %q, got %q", "hello_network\n", execResult.Stdout)
			}
		})

		// Stdin streaming
		t.Run("Stdin input", func(t *testing.T) {
			stdinContent := "network_stdin_data"
			execResp, err := basicClient.Execute(ctx, connect.NewRequest(&computer_apiv1.ExecuteRequest{
				SessionId: sessionID,
				Command:   "cat",
				Stdin:     &stdinContent,
			}))
			if err != nil {
				t.Fatalf("Execute RPC failed: %v", err)
			}
			execResult := execResp.Msg.GetExecResult()
			if execResult == nil {
				t.Fatalf("expected ExecResult, got error: %v", execResp.Msg.GetErrorMessage())
			}
			if execResult.Stdout != stdinContent {
				t.Errorf("expected stdout %q, got %q", stdinContent, execResult.Stdout)
			}
		})

		// Stderr and non-zero exit code
		t.Run("Stderr and Non-zero exit code", func(t *testing.T) {
			cmdStr := "echo network_error >&2; exit 7"
			shell := "sh"
			execResp, err := basicClient.Execute(ctx, connect.NewRequest(&computer_apiv1.ExecuteRequest{
				SessionId: sessionID,
				Command:   cmdStr,
				Shell:     &shell,
			}))
			if err != nil {
				t.Fatalf("Execute RPC failed: %v", err)
			}
			execResult := execResp.Msg.GetExecResult()
			if execResult == nil {
				t.Fatalf("expected ExecResult, got error: %v", execResp.Msg.GetErrorMessage())
			}
			if execResult.ExitCode != 7 {
				t.Errorf("expected exit code 7, got %d", execResult.ExitCode)
			}
			if execResult.Stderr != "network_error\n" {
				t.Errorf("expected stderr %q, got %q", "network_error\n", execResult.Stderr)
			}
		})

		// Environment variables and working directory
		t.Run("EnvVars and Cwd", func(t *testing.T) {
			tempDir := t.TempDir()
			cmdStr := "pwd && echo $TEST_NET_ENV"
			shell := "sh"
			execResp, err := basicClient.Execute(ctx, connect.NewRequest(&computer_apiv1.ExecuteRequest{
				SessionId: sessionID,
				Command:   cmdStr,
				Shell:     &shell,
				Cwd:       &tempDir,
				EnvVars: map[string]string{
					"TEST_NET_ENV": "net_val_123",
				},
			}))
			if err != nil {
				t.Fatalf("Execute RPC failed: %v", err)
			}
			execResult := execResp.Msg.GetExecResult()
			if execResult == nil {
				t.Fatalf("expected ExecResult, got error: %v", execResp.Msg.GetErrorMessage())
			}
			expectedOutput := tempDir + "\nnet_val_123\n"
			if execResult.Stdout != expectedOutput {
				t.Errorf("expected stdout %q, got %q", expectedOutput, execResult.Stdout)
			}
		})
	})

	t.Run("BasicComputerService - File Operations", func(t *testing.T) {
		sessionID := "0"
		tempDir := t.TempDir()
		testFilePath := filepath.Join(tempDir, "network_test.txt")
		fileContent := []byte("hello network filesystem")

		// WriteFile RPC
		writeResp, err := basicClient.WriteFile(ctx, connect.NewRequest(&computer_apiv1.WriteFileRequest{
			SessionId: sessionID,
			Path:      testFilePath,
			Content:   fileContent,
		}))
		if err != nil {
			t.Fatalf("WriteFile RPC failed: %v", err)
		}
		if writeResp.Msg.GetResp() == nil {
			t.Fatalf("expected SuccessWriteResponse, got error: %v", writeResp.Msg.GetErrorMessage())
		}

		// ReadFile RPC
		readResp, err := basicClient.ReadFile(ctx, connect.NewRequest(&computer_apiv1.ReadFileRequest{
			SessionId: sessionID,
			Path:      testFilePath,
		}))
		if err != nil {
			t.Fatalf("ReadFile RPC failed: %v", err)
		}
		if readResp.Msg.GetContent() == nil {
			t.Fatalf("expected file content, got error: %v", readResp.Msg.GetErrorMessage())
		}
		if string(readResp.Msg.GetContent()) != string(fileContent) {
			t.Errorf("expected file content %q, got %q", string(fileContent), string(readResp.Msg.GetContent()))
		}

		// ListDirectory RPC
		listResp, err := basicClient.ListDirectory(ctx, connect.NewRequest(&computer_apiv1.ListDirectoryRequest{
			SessionId: sessionID,
			Path:      tempDir,
		}))
		if err != nil {
			t.Fatalf("ListDirectory RPC failed: %v", err)
		}
		listResult := listResp.Msg.GetResponse()
		if listResult == nil {
			t.Fatalf("expected SuccessListDirectoryResponse, got error: %v", listResp.Msg.GetErrorMessage())
		}
		found := false
		for _, fileName := range listResult.Files {
			if fileName == "network_test.txt" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected network_test.txt in list directory results %v", listResult.Files)
		}
	})

	t.Run("BasicComputerService - GetUserId and GetGroupId", func(t *testing.T) {
		sessionID := "0"

		uidResp, err := basicClient.GetUserId(ctx, connect.NewRequest(&computer_apiv1.GetUserIdRequest{
			SessionId: sessionID,
		}))
		if err != nil {
			t.Fatalf("GetUserId RPC failed: %v", err)
		}
		if uidResp.Msg.GetUserId() == "" {
			t.Fatalf("expected non-empty UserId, got error: %v", uidResp.Msg.GetErrorMessage())
		}

		gidResp, err := basicClient.GetGroupId(ctx, connect.NewRequest(&computer_apiv1.GetGroupIdRequest{
			SessionId: sessionID,
		}))
		if err != nil {
			t.Fatalf("GetGroupId RPC failed: %v", err)
		}
		if gidResp.Msg.GetGroupId() == "" {
			t.Fatalf("expected non-empty GroupId, got error: %v", gidResp.Msg.GetErrorMessage())
		}
	})
}

func generateTestCertificates(t *testing.T, dir string) (certFile, keyFile, caFile, clientCertFile, clientKeyFile string) {
	t.Helper()

	// 1. Generate CA key & cert
	caPrivKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate CA private key: %v", err)
	}

	caTemplate := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test CA"},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}

	caCertBytes, err := x509.CreateCertificate(rand.Reader, &caTemplate, &caTemplate, &caPrivKey.PublicKey, caPrivKey)
	if err != nil {
		t.Fatalf("failed to create CA certificate: %v", err)
	}

	caFile = filepath.Join(dir, "ca.crt")
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCertBytes})
	if err := os.WriteFile(caFile, caPEM, 0644); err != nil {
		t.Fatalf("failed to write CA cert: %v", err)
	}

	// 2. Generate Server key & cert (signed by CA)
	serverPrivKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate server key: %v", err)
	}

	serverTemplate := x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-1 * time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:     []string{"localhost"},
	}

	serverCertBytes, err := x509.CreateCertificate(rand.Reader, &serverTemplate, &caTemplate, &serverPrivKey.PublicKey, caPrivKey)
	if err != nil {
		t.Fatalf("failed to create server certificate: %v", err)
	}

	certFile = filepath.Join(dir, "server.crt")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverCertBytes})
	if err := os.WriteFile(certFile, certPEM, 0644); err != nil {
		t.Fatalf("failed to write server cert: %v", err)
	}

	keyFile = filepath.Join(dir, "server.key")
	serverKeyBytes, err := x509.MarshalECPrivateKey(serverPrivKey)
	if err != nil {
		t.Fatalf("failed to marshal server key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: serverKeyBytes})
	if err := os.WriteFile(keyFile, keyPEM, 0600); err != nil {
		t.Fatalf("failed to write server key: %v", err)
	}

	// 3. Generate Client key & cert (signed by CA)
	clientPrivKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate client key: %v", err)
	}

	clientTemplate := x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject:      pkix.Name{CommonName: "Test Client"},
		NotBefore:    time.Now().Add(-1 * time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}

	clientCertBytes, err := x509.CreateCertificate(rand.Reader, &clientTemplate, &caTemplate, &clientPrivKey.PublicKey, caPrivKey)
	if err != nil {
		t.Fatalf("failed to create client certificate: %v", err)
	}

	clientCertFile = filepath.Join(dir, "client.crt")
	clientCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: clientCertBytes})
	if err := os.WriteFile(clientCertFile, clientCertPEM, 0644); err != nil {
		t.Fatalf("failed to write client cert: %v", err)
	}

	clientKeyFile = filepath.Join(dir, "client.key")
	clientKeyBytes, err := x509.MarshalECPrivateKey(clientPrivKey)
	if err != nil {
		t.Fatalf("failed to marshal client key: %v", err)
	}
	clientKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: clientKeyBytes})
	if err := os.WriteFile(clientKeyFile, clientKeyPEM, 0600); err != nil {
		t.Fatalf("failed to write client key: %v", err)
	}

	return certFile, keyFile, caFile, clientCertFile, clientKeyFile
}

func TestServerTLSAndMTLS(t *testing.T) {
	tempDir := t.TempDir()
	certFile, keyFile, caFile, clientCertFile, clientKeyFile := generateTestCertificates(t, tempDir)

	cfg := &config.ServerConfig{
		Type: config.TypeLocal,
		Server: config.ServerNetworkConfig{
			Security: config.ServerSecurityConfig{
				Tls: config.TlsConfig{
					TlsCertificate:         certFile,
					TlsCertificateKey:      keyFile,
					TlsTrustedCertificates: caFile,
				},
			},
		},
	}

	handler, err := server.NewServerHandler(cfg)
	if err != nil {
		t.Fatalf("failed to create server handler: %v", err)
	}

	serverCert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		t.Fatalf("failed to load server key pair: %v", err)
	}

	caPool := x509.NewCertPool()
	caPEM, err := os.ReadFile(caFile)
	if err != nil {
		t.Fatalf("failed to read CA cert file: %v", err)
	}
	if ok := caPool.AppendCertsFromPEM(caPEM); !ok {
		t.Fatal("failed to append CA cert to pool")
	}

	ctx := context.Background()

	t.Run("HTTP Client hitting TLS Server returns error", func(t *testing.T) {
		ts := httptest.NewUnstartedServer(handler)
		ts.TLS = &tls.Config{
			Certificates: []tls.Certificate{serverCert},
		}
		ts.StartTLS()
		defer ts.Close()

		plainHTTPClient := &http.Client{}
		httpURL := strings.Replace(ts.URL, "https://", "http://", 1)
		client := computer_apiv1connect.NewBasicComputerServiceClient(plainHTTPClient, httpURL)

		_, err := client.GetUserId(ctx, connect.NewRequest(&computer_apiv1.GetUserIdRequest{SessionId: "0"}))
		if err == nil {
			t.Fatal("expected error when plain HTTP client hits TLS server, got nil")
		}
	})

	t.Run("HTTPS Client hitting TLS Server succeeds", func(t *testing.T) {
		ts := httptest.NewUnstartedServer(handler)
		ts.TLS = &tls.Config{
			Certificates: []tls.Certificate{serverCert},
		}
		ts.StartTLS()
		defer ts.Close()

		tlsClient := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					RootCAs: caPool,
				},
			},
		}
		client := computer_apiv1connect.NewBasicComputerServiceClient(tlsClient, ts.URL)

		resp, err := client.GetUserId(ctx, connect.NewRequest(&computer_apiv1.GetUserIdRequest{SessionId: "0"}))
		if err != nil {
			t.Fatalf("expected HTTPS request to succeed, got: %v", err)
		}
		if resp.Msg.GetUserId() == "" {
			t.Fatal("expected non-empty UserId")
		}
	})

	t.Run("mTLS Server without client cert returns error", func(t *testing.T) {
		ts := httptest.NewUnstartedServer(handler)
		ts.TLS = &tls.Config{
			Certificates: []tls.Certificate{serverCert},
			ClientAuth:   tls.RequireAndVerifyClientCert,
			ClientCAs:    caPool,
		}
		ts.StartTLS()
		defer ts.Close()

		noCertClient := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					RootCAs: caPool,
				},
			},
		}
		client := computer_apiv1connect.NewBasicComputerServiceClient(noCertClient, ts.URL)

		_, err := client.GetUserId(ctx, connect.NewRequest(&computer_apiv1.GetUserIdRequest{SessionId: "0"}))
		if err == nil {
			t.Fatal("expected error when client sends no certificate to mTLS server, got nil")
		}
	})

	t.Run("mTLS Server with valid client cert succeeds", func(t *testing.T) {
		ts := httptest.NewUnstartedServer(handler)
		ts.TLS = &tls.Config{
			Certificates: []tls.Certificate{serverCert},
			ClientAuth:   tls.RequireAndVerifyClientCert,
			ClientCAs:    caPool,
		}
		ts.StartTLS()
		defer ts.Close()

		clientCert, err := tls.LoadX509KeyPair(clientCertFile, clientKeyFile)
		if err != nil {
			t.Fatalf("failed to load client key pair: %v", err)
		}

		mTLSClient := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					RootCAs:      caPool,
					Certificates: []tls.Certificate{clientCert},
				},
			},
		}
		client := computer_apiv1connect.NewBasicComputerServiceClient(mTLSClient, ts.URL)

		resp, err := client.GetUserId(ctx, connect.NewRequest(&computer_apiv1.GetUserIdRequest{SessionId: "0"}))
		if err != nil {
			t.Fatalf("expected mTLS request with valid client cert to succeed, got: %v", err)
		}
		if resp.Msg.GetUserId() == "" {
			t.Fatal("expected non-empty UserId")
		}
	})
}

func TestServerAPIKeyAuth(t *testing.T) {
	apiKey := "test-secret-key-123"

	cfg := &config.ServerConfig{
		Type: config.TypeLocal,
		Server: config.ServerNetworkConfig{
			Security: config.ServerSecurityConfig{
				ApiKey: apiKey,
			},
		},
	}

	handler, err := server.NewServerHandler(cfg)
	if err != nil {
		t.Fatalf("failed to create server handler: %v", err)
	}

	ts := httptest.NewServer(handler)
	defer ts.Close()

	ctx := context.Background()
	client := computer_apiv1connect.NewBasicComputerServiceClient(ts.Client(), ts.URL)

	t.Run("Missing Authorization Header returns error", func(t *testing.T) {
		req := connect.NewRequest(&computer_apiv1.GetUserIdRequest{SessionId: "0"})
		_, err := client.GetUserId(ctx, req)
		if err == nil {
			t.Fatal("expected error for missing API key, got nil")
		}
		if connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Errorf("expected CodeUnauthenticated, got %v", connect.CodeOf(err))
		}
	})

	t.Run("Invalid API Key returns error", func(t *testing.T) {
		req := connect.NewRequest(&computer_apiv1.GetUserIdRequest{SessionId: "0"})
		req.Header().Set("Authorization", "Bearer wrong-key")
		_, err := client.GetUserId(ctx, req)
		if err == nil {
			t.Fatal("expected error for invalid API key, got nil")
		}
		if connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Errorf("expected CodeUnauthenticated, got %v", connect.CodeOf(err))
		}
	})

	t.Run("Valid API Key succeeds", func(t *testing.T) {
		req := connect.NewRequest(&computer_apiv1.GetUserIdRequest{SessionId: "0"})
		req.Header().Set("Authorization", "Bearer "+apiKey)
		resp, err := client.GetUserId(ctx, req)
		if err != nil {
			t.Fatalf("expected request with valid API key to succeed, got: %v", err)
		}
		if resp.Msg.GetUserId() == "" {
			t.Fatal("expected non-empty UserId")
		}
	})
}
