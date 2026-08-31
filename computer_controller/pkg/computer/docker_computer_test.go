package computer

import (
	"bytes"
	"context"
	"os"
	"testing"
)

// skipIfNoDocker skips the test if the DOCKER_INTEGRATION_TEST environment variable is not set.
// Docker integration tests require a running Docker daemon and network access to pull images.
func skipIfNoDocker(t *testing.T) {
	t.Helper()
	if os.Getenv("DOCKER_INTEGRATION_TEST") == "" {
		t.Skip("Skipping Docker integration test. Set DOCKER_INTEGRATION_TEST=1 to run.")
	}
}

// testImage is the Docker image used for integration tests.
const testImage = "alpine:latest"

// setupDockerComputer creates a DockerComputerProvider, creates a computer with the test image,
// and returns the computer along with a cleanup function that deletes the computer.
func setupDockerComputer(t *testing.T) (IComputer, func()) {
	t.Helper()

	provider, err := GetDockerComputerProvider(DockerComputerProviderProps{
		pullMode: IfNotPresent,
	})
	if err != nil {
		t.Fatalf("failed to create DockerComputerProvider: %v", err)
	}

	ctx := context.Background()
	sessionId, err := provider.CreateComputer(ctx, ComputerConfig{
		Image: testImage,
	})
	if err != nil {
		t.Fatalf("failed to create computer: %v", err)
	}

	comp, err := provider.GetComputer(ctx, sessionId)
	if err != nil {
		t.Fatalf("failed to get computer: %v", err)
	}

	cleanup := func() {
		provider.DeleteComputer(context.Background(), sessionId)
		if closer, ok := provider.(interface{ Close() error }); ok {
			closer.Close()
		}
	}

	return comp, cleanup
}

func TestDockerComputerExecute(t *testing.T) {
	skipIfNoDocker(t)

	comp, cleanup := setupDockerComputer(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("Simple Echo", func(t *testing.T) {
		input := ExecInput{
			Command: "echo 'hello docker'",
		}

		res, err := comp.Execute(ctx, input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if res.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", res.ExitCode)
		}
		if res.Stdout != "hello docker\n" {
			t.Errorf("expected stdout %q, got %q", "hello docker\n", res.Stdout)
		}
	})

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

	t.Run("Custom Shell (Bash via sh)", func(t *testing.T) {
		shell := "sh"
		input := ExecInput{
			Shell:   &shell,
			Command: "echo 'hello from sh'",
		}

		res, err := comp.Execute(ctx, input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if res.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", res.ExitCode)
		}
		if res.Stdout != "hello from sh\n" {
			t.Errorf("expected stdout %q, got %q", "hello from sh\n", res.Stdout)
		}
	})
}

func TestDockerComputerFileOperations(t *testing.T) {
	skipIfNoDocker(t)

	comp, cleanup := setupDockerComputer(t)
	defer cleanup()

	ctx := context.Background()

	testFilePath := "/tmp/docker_test_sample.txt"
	testContent := []byte("hello binary file content")

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
		// write a second file so we can verify multiple entries
		secondFilePath := "/tmp/docker_test_other.txt"
		if err := comp.WriteFile(ctx, secondFilePath, []byte("other")); err != nil {
			t.Fatalf("WriteFile for second file failed: %v", err)
		}

		// create a subdirectory via exec
		_, err := comp.Execute(ctx, ExecInput{Command: "mkdir -p /tmp/docker_test_subdir"})
		if err != nil {
			t.Fatalf("failed to create subdirectory: %v", err)
		}

		entries, err := comp.ListDirectory(ctx, "/tmp")
		if err != nil {
			t.Fatalf("ListDirectory failed: %v", err)
		}

		// verify we can find our test files and subdirectory
		foundFile := false
		foundOther := false
		foundDir := false

		for _, entry := range entries {
			switch entry.Name {
			case "docker_test_sample.txt":
				foundFile = true
				if entry.IsDir {
					t.Errorf("expected file, got directory for docker_test_sample.txt")
				}
				if entry.Size != int64(len(testContent)) {
					t.Errorf("expected file size %d, got %d", len(testContent), entry.Size)
				}
			case "docker_test_other.txt":
				foundOther = true
				if entry.IsDir {
					t.Errorf("expected file, got directory for docker_test_other.txt")
				}
			case "docker_test_subdir":
				foundDir = true
				if !entry.IsDir {
					t.Errorf("expected directory, got file for docker_test_subdir")
				}
			}
		}

		if !foundFile {
			t.Errorf("docker_test_sample.txt not found in directory listing")
		}
		if !foundOther {
			t.Errorf("docker_test_other.txt not found in directory listing")
		}
		if !foundDir {
			t.Errorf("docker_test_subdir not found in directory listing")
		}
	})
}

func TestDockerComputerUserAndGroupInfo(t *testing.T) {
	skipIfNoDocker(t)

	comp, cleanup := setupDockerComputer(t)
	defer cleanup()

	t.Run("Default Root User", func(t *testing.T) {
		// alpine:latest runs as root by default
		uid, err := comp.GetUserId()
		if err != nil {
			t.Fatalf("GetUserId returned error: %v", err)
		}
		if uid != "0" {
			t.Errorf("expected uid '0' for default root, got %q", uid)
		}

		gid, err := comp.GetGroupId()
		if err != nil {
			t.Fatalf("GetGroupId returned error: %v", err)
		}
		if gid != "0" {
			t.Errorf("expected gid '0' for default root, got %q", gid)
		}
	})

	t.Run("Caching - Multiple Calls Same Result", func(t *testing.T) {
		// calling GetUserId and GetGroupId multiple times should return cached values
		uid1, _ := comp.GetUserId()
		uid2, _ := comp.GetUserId()
		gid1, _ := comp.GetGroupId()
		gid2, _ := comp.GetGroupId()

		if uid1 != uid2 {
			t.Errorf("GetUserId not cached: got %q then %q", uid1, uid2)
		}
		if gid1 != gid2 {
			t.Errorf("GetGroupId not cached: got %q then %q", gid1, gid2)
		}
	})
}

func TestDockerComputerSessionId(t *testing.T) {
	skipIfNoDocker(t)

	comp, cleanup := setupDockerComputer(t)
	defer cleanup()

	sessionId := comp.GetSessionId()
	if sessionId == "" {
		t.Errorf("expected non-empty sessionId")
	}
}

func TestDockerComputerProviderLifecycle(t *testing.T) {
	skipIfNoDocker(t)

	provider, err := GetDockerComputerProvider(DockerComputerProviderProps{
		pullMode: IfNotPresent,
	})
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	ctx := context.Background()

	t.Run("Create and Delete", func(t *testing.T) {
		sessionId, err := provider.CreateComputer(ctx, ComputerConfig{
			Image: testImage,
		})
		if err != nil {
			t.Fatalf("CreateComputer failed: %v", err)
		}

		// should be able to get the computer
		_, err = provider.GetComputer(ctx, sessionId)
		if err != nil {
			t.Fatalf("GetComputer failed: %v", err)
		}

		// delete the computer
		err = provider.DeleteComputer(ctx, sessionId)
		if err != nil {
			t.Fatalf("DeleteComputer failed: %v", err)
		}

		// getting deleted computer should fail
		_, err = provider.GetComputer(ctx, sessionId)
		if err == nil {
			t.Errorf("expected error getting deleted computer, got nil")
		}
	})

	t.Run("Delete Non-Existent is No-Op", func(t *testing.T) {
		err := provider.DeleteComputer(ctx, "non-existent-session-id")
		if err != nil {
			t.Errorf("expected no error deleting non-existent computer, got: %v", err)
		}
	})
}
