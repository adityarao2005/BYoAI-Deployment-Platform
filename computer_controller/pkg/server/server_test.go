package server_test

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"testing"

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
