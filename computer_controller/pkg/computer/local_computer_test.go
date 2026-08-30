package computer

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalComputerExecute(t *testing.T) {
	comp := LocalComputer{sessionId: "test-session"}
	ctx := context.Background()

	t.Run("Stdout and Stdin", func(t *testing.T) {
		stdinVal := "hello from stdin\n"
		input := ExecInput{
			Command: "cat",
			Stdin:   &stdinVal,
		}

		res, err := comp.Execute(ctx, input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if res.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", res.ExitCode)
		}
		if res.Stdout != stdinVal {
			t.Errorf("expected stdout %q, got %q", stdinVal, res.Stdout)
		}
	})

	t.Run("Stderr and Non-Zero Exit Code", func(t *testing.T) {
		input := ExecInput{
			Command: "echo 'error message' >&2; exit 42",
		}

		res, err := comp.Execute(ctx, input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if res.ExitCode != 42 {
			t.Errorf("expected exit code 42, got %d", res.ExitCode)
		}
		if res.Stderr != "error message\n" {
			t.Errorf("expected stderr %q, got %q", "error message\n", res.Stderr)
		}
	})

	t.Run("Environment Variables and CWD", func(t *testing.T) {
		cwd := "/"
		env := []EnvVar{
			{Name: "MY_TEST_VAR", Value: "test_val"},
		}
		input := ExecInput{
			Command: "echo $MY_TEST_VAR && pwd",
			Cwd:     &cwd,
			Env:     &env,
		}

		res, err := comp.Execute(ctx, input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if res.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", res.ExitCode)
		}
		expectedOutput := "test_val\n/\n"
		if res.Stdout != expectedOutput {
			t.Errorf("expected stdout %q, got %q", expectedOutput, res.Stdout)
		}
	})

	t.Run("Custom Shell (Python)", func(t *testing.T) {
		shell := "python3"
		input := ExecInput{
			Shell:   &shell,
			Command: "print('hello from python')",
		}

		res, err := comp.Execute(ctx, input)
		if err != nil {
			t.Fatalf("unexpected error executing with python3: %v", err)
		}

		if res.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", res.ExitCode)
		}
		if res.Stdout != "hello from python\n" {
			t.Errorf("expected stdout %q, got %q", "hello from python\n", res.Stdout)
		}
	})

	t.Run("Configurable WaitDelay", func(t *testing.T) {
		waitDelay := 500 * time.Millisecond
		input := ExecInput{
			Command:   "echo 'delay test'",
			WaitDelay: &waitDelay,
		}

		res, err := comp.Execute(ctx, input)
		if err != nil {
			t.Fatalf("unexpected error with WaitDelay: %v", err)
		}

		if res.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", res.ExitCode)
		}
		if res.Stdout != "delay test\n" {
			t.Errorf("expected stdout %q, got %q", "delay test\n", res.Stdout)
		}
	})
}

func TestLocalComputerFileAndUserOperations(t *testing.T) {
	comp := LocalComputer{sessionId: "0"}
	ctx := context.Background()

	tmpDir, err := os.MkdirTemp("", "local_computer_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	testFilePath := filepath.Join(tmpDir, "sample.txt")
	testContent := []byte("hello binary file context")

	t.Run("WriteFile and ReadFile", func(t *testing.T) {
		if err := comp.WriteFile(ctx, testFilePath, testContent); err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}

		readBytes, err := comp.ReadFile(ctx, testFilePath)
		if err != nil {
			t.Fatalf("ReadFile failed: %v", err)
		}

		if !bytes.Equal(readBytes, testContent) {
			t.Errorf("expected content %q, got %q", testContent, readBytes)
		}
	})

	t.Run("ListDirectory", func(t *testing.T) {
		entries, err := comp.ListDirectory(ctx, tmpDir)
		if err != nil {
			t.Fatalf("ListDirectory failed: %v", err)
		}

		if len(entries) != 1 {
			t.Fatalf("expected 1 entry, got %d", len(entries))
		}

		if entries[0].Name != "sample.txt" {
			t.Errorf("expected file name 'sample.txt', got %q", entries[0].Name)
		}
		if entries[0].IsDir {
			t.Errorf("expected file, got directory")
		}
		if entries[0].Size != int64(len(testContent)) {
			t.Errorf("expected file size %d, got %d", len(testContent), entries[0].Size)
		}
	})

	t.Run("User and Group Info", func(t *testing.T) {
		uid, err := comp.GetUserId()
		if err != nil || uid == "" {
			t.Errorf("GetUserId returned empty or error: %v", err)
		}

		gid, err := comp.GetGroupId()
		if err != nil || gid == "" {
			t.Errorf("GetGroupId returned empty or error: %v", err)
		}

		if comp.GetSessionId() != "0" {
			t.Errorf("expected sessionId '0', got %q", comp.GetSessionId())
		}
	})
}
