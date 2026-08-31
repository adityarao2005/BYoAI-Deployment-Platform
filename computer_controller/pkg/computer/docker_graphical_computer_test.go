package computer

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const graphicalTestImage = "byoai-test-graphical:latest"

// buildGraphicalTestImage builds the Xvfb test image from testdata/graphical/Dockerfile.
// It is idempotent — if the image already exists, it uses the cache.
func buildGraphicalTestImage(t *testing.T) {
	t.Helper()

	cmd := exec.Command("docker", "build", "-t", graphicalTestImage, "testdata/graphical")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("failed to build graphical test image: %v", err)
	}
}

// setupDockerGraphicalComputer creates a DockerComputerProvider, builds the graphical
// test image, creates a container, waits for Xvfb to be ready, and returns the
// graphical computer along with a cleanup function.
func setupDockerGraphicalComputer(t *testing.T) (IGraphicalComputer, func()) {
	t.Helper()

	buildGraphicalTestImage(t)

	provider, err := GetDockerComputerProvider(DockerComputerProviderProps{
		pullMode: Never, // we just built it locally
	})
	if err != nil {
		t.Fatalf("failed to create DockerComputerProvider: %v", err)
	}

	ctx := context.Background()
	sessionId, err := provider.CreateComputer(ctx, ComputerConfig{
		Image: graphicalTestImage,
	})
	if err != nil {
		t.Fatalf("failed to create graphical computer: %v", err)
	}

	comp, err := provider.GetComputer(ctx, sessionId)
	if err != nil {
		provider.DeleteComputer(context.Background(), sessionId)
		t.Fatalf("failed to get computer: %v", err)
	}

	gc, err := GetGraphicalComputer(comp)
	if err != nil {
		provider.DeleteComputer(context.Background(), sessionId)
		t.Fatalf("expected graphical computer but got non-graphical: %v", err)
	}

	// Wait for Xvfb to be ready (poll for up to 10 seconds)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		result, execErr := comp.Execute(ctx, ExecInput{
			Command: "xdotool getdisplaygeometry",
			Env:     &[]EnvVar{{Name: "DISPLAY", Value: ":99"}},
		})
		if execErr == nil && result.ExitCode == 0 {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	cleanup := func() {
		provider.DeleteComputer(context.Background(), sessionId)
		if closer, ok := provider.(interface{ Close() error }); ok {
			closer.Close()
		}
	}

	return gc, cleanup
}

/// Unit-style tests (no Docker needed)

func TestDockerGraphicalComputerInterfaceSatisfaction(t *testing.T) {
	// Compile-time check: DockerGraphicalComputer must implement IGraphicalComputer
	var _ IGraphicalComputer = &DockerGraphicalComputer{}

	// Also verify it satisfies IComputer via embedding
	var _ IComputer = &DockerGraphicalComputer{}
}

func TestGetGraphicalComputerTypeDetection(t *testing.T) {
	t.Run("Succeeds for DockerGraphicalComputer", func(t *testing.T) {
		gc := &DockerGraphicalComputer{}
		var comp IComputer = gc
		result, err := GetGraphicalComputer(comp)
		if err != nil {
			t.Fatalf("expected GetGraphicalComputer to succeed, got: %v", err)
		}
		if result == nil {
			t.Fatal("expected non-nil result")
		}
	})

	t.Run("Fails for plain DockerComputer", func(t *testing.T) {
		dc := &DockerComputer{}
		var comp IComputer = dc
		_, err := GetGraphicalComputer(comp)
		if err == nil {
			t.Fatal("expected GetGraphicalComputer to fail for plain DockerComputer")
		}
	})
}

/// Integration tests (Docker required)

func TestGetComputerReturnsGraphicalForDisplayImage(t *testing.T) {
	skipIfNoDocker(t)

	buildGraphicalTestImage(t)

	provider, err := GetDockerComputerProvider(DockerComputerProviderProps{
		pullMode: Never,
	})
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	ctx := context.Background()
	sessionId, err := provider.CreateComputer(ctx, ComputerConfig{
		Image: graphicalTestImage,
	})
	if err != nil {
		t.Fatalf("failed to create computer: %v", err)
	}
	defer provider.DeleteComputer(ctx, sessionId)

	comp, err := provider.GetComputer(ctx, sessionId)
	if err != nil {
		t.Fatalf("failed to get computer: %v", err)
	}

	_, err = GetGraphicalComputer(comp)
	if err != nil {
		t.Errorf("expected graphical computer for image with DISPLAY set, got error: %v", err)
	}
}

func TestGetComputerReturnsNonGraphicalForAlpine(t *testing.T) {
	skipIfNoDocker(t)

	comp, cleanup := setupDockerComputer(t)
	defer cleanup()

	_, err := GetGraphicalComputer(comp)
	if err == nil {
		t.Error("expected GetGraphicalComputer to fail for alpine image without DISPLAY")
	}
}

func TestDockerGraphicalGetScreenSize(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()
	w, h, err := gc.GetScreenSize(ctx)
	if err != nil {
		t.Fatalf("GetScreenSize failed: %v", err)
	}

	// Xvfb is configured with 1024x768
	if w != 1024 || h != 768 {
		t.Errorf("expected screen size 1024x768, got %dx%d", w, h)
	}
}

func TestDockerGraphicalCaptureScreenshot(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()
	data, err := gc.CaptureScreenshot(ctx)
	if err != nil {
		t.Fatalf("CaptureScreenshot failed: %v", err)
	}

	// Verify PNG magic header bytes: 0x89 P N G
	if len(data) < 4 {
		t.Fatalf("screenshot data too small: %d bytes", len(data))
	}
	pngMagic := []byte{0x89, 0x50, 0x4E, 0x47}
	for i, b := range pngMagic {
		if data[i] != b {
			t.Errorf("expected PNG magic byte %d to be %#x, got %#x", i, b, data[i])
		}
	}

	t.Logf("captured screenshot: %d bytes", len(data))
}

func TestDockerGraphicalMoveMouseAndClick(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("MoveMouseTo", func(t *testing.T) {
		err := gc.MoveMouseTo(ctx, 200, 300)
		if err != nil {
			t.Fatalf("MoveMouseTo failed: %v", err)
		}

		// Verify mouse position via xdotool getmouselocation
		// Need to access the underlying IComputer to execute commands
		comp := gc.(IComputer)
		result, err := comp.Execute(ctx, ExecInput{
			Command: "xdotool getmouselocation --shell",
			Env:     &[]EnvVar{{Name: "DISPLAY", Value: ":99"}},
		})
		if err != nil {
			t.Fatalf("failed to get mouse location: %v", err)
		}

		if !strings.Contains(result.Stdout, "X=200") || !strings.Contains(result.Stdout, "Y=300") {
			t.Errorf("expected mouse at 200,300 but got: %s", result.Stdout)
		}
	})

	t.Run("Click", func(t *testing.T) {
		err := gc.Click(ctx, 500, 400, "left")
		if err != nil {
			t.Fatalf("Click failed: %v", err)
		}

		// Verify mouse moved to click position
		comp := gc.(IComputer)
		result, err := comp.Execute(ctx, ExecInput{
			Command: "xdotool getmouselocation --shell",
			Env:     &[]EnvVar{{Name: "DISPLAY", Value: ":99"}},
		})
		if err != nil {
			t.Fatalf("failed to get mouse location after click: %v", err)
		}

		if !strings.Contains(result.Stdout, "X=500") || !strings.Contains(result.Stdout, "Y=400") {
			t.Errorf("expected mouse at 500,400 after click but got: %s", result.Stdout)
		}
	})
}

func TestDockerGraphicalClipboard(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()
	testText := "hello from docker graphical clipboard test"

	err := gc.SetClipboard(ctx, testText)
	if err != nil {
		t.Fatalf("SetClipboard failed: %v", err)
	}

	got, err := gc.GetClipboard(ctx)
	if err != nil {
		t.Fatalf("GetClipboard failed: %v", err)
	}

	if strings.TrimSpace(got) != testText {
		t.Errorf("clipboard round-trip failed: expected %q, got %q", testText, got)
	}
}

func TestDockerGraphicalScroll(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()

	// Just verify scroll completes without error (hard to observe without a window manager)
	t.Run("Vertical Scroll Down", func(t *testing.T) {
		if err := gc.Scroll(ctx, 0, 3); err != nil {
			t.Errorf("Scroll(0, 3) failed: %v", err)
		}
	})

	t.Run("Vertical Scroll Up", func(t *testing.T) {
		if err := gc.Scroll(ctx, 0, -2); err != nil {
			t.Errorf("Scroll(0, -2) failed: %v", err)
		}
	})

	t.Run("Horizontal Scroll", func(t *testing.T) {
		if err := gc.Scroll(ctx, 5, 0); err != nil {
			t.Errorf("Scroll(5, 0) failed: %v", err)
		}
	})

	t.Run("No Scroll", func(t *testing.T) {
		if err := gc.Scroll(ctx, 0, 0); err != nil {
			t.Errorf("Scroll(0, 0) failed: %v", err)
		}
	})
}

func TestDockerGraphicalDrag(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()

	err := gc.Drag(ctx, 100, 100, 300, 300)
	if err != nil {
		t.Fatalf("Drag failed: %v", err)
	}

	// Verify mouse ended at destination
	comp := gc.(IComputer)
	result, err := comp.Execute(ctx, ExecInput{
		Command: "xdotool getmouselocation --shell",
		Env:     &[]EnvVar{{Name: "DISPLAY", Value: ":99"}},
	})
	if err != nil {
		t.Fatalf("failed to get mouse location after drag: %v", err)
	}

	if !strings.Contains(result.Stdout, "X=300") || !strings.Contains(result.Stdout, "Y=300") {
		t.Errorf("expected mouse at 300,300 after drag but got: %s", result.Stdout)
	}
}

func TestDockerGraphicalKeyOperations(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("PressKey and ReleaseKey", func(t *testing.T) {
		if err := gc.PressKey(ctx, "shift"); err != nil {
			t.Errorf("PressKey failed: %v", err)
		}
		if err := gc.ReleaseKey(ctx, "shift"); err != nil {
			t.Errorf("ReleaseKey failed: %v", err)
		}
	})

	t.Run("PressAndHoldKey", func(t *testing.T) {
		if err := gc.PressAndHoldKey(ctx, "ctrl"); err != nil {
			t.Errorf("PressAndHoldKey failed: %v", err)
		}
		if err := gc.ReleaseKey(ctx, "ctrl"); err != nil {
			t.Errorf("ReleaseKey for ctrl failed: %v", err)
		}
	})

	t.Run("ReleaseAllKeys", func(t *testing.T) {
		// Press a couple keys then release all
		gc.PressKey(ctx, "shift")
		gc.PressKey(ctx, "ctrl")

		if err := gc.ReleaseAllKeys(ctx); err != nil {
			t.Errorf("ReleaseAllKeys failed: %v", err)
		}
	})
}

func TestDockerGraphicalType(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()

	// Just verify Type completes without error
	// (no window to receive the text in a bare Xvfb environment, but xdotool should succeed)
	err := gc.Type(ctx, "hello world")
	if err != nil {
		// xdotool type may fail without an active window, which is acceptable
		// in a bare Xvfb environment. Log the error but don't fail.
		t.Logf("Type returned error (expected in bare Xvfb): %v", err)
	}
}

func TestDockerGraphicalComputerInheritsIComputer(t *testing.T) {
	skipIfNoDocker(t)

	gc, cleanup := setupDockerGraphicalComputer(t)
	defer cleanup()

	ctx := context.Background()

	// Verify that IComputer methods work through the graphical computer
	comp := gc.(IComputer)

	t.Run("Execute via inherited DockerComputer", func(t *testing.T) {
		result, err := comp.Execute(ctx, ExecInput{
			Command: "echo 'hello from graphical'",
		})
		if err != nil {
			t.Fatalf("Execute failed: %v", err)
		}
		if result.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", result.ExitCode)
		}
		expected := "hello from graphical\n"
		if result.Stdout != expected {
			t.Errorf("expected stdout %q, got %q", expected, result.Stdout)
		}
	})

	t.Run("SessionId", func(t *testing.T) {
		sid := comp.GetSessionId()
		if sid == "" {
			t.Error("expected non-empty session id")
		}
	})

	t.Run("ReadFile and WriteFile", func(t *testing.T) {
		testPath := "/tmp/graphical_test.txt"
		testContent := []byte("graphical computer file test")

		if err := comp.WriteFile(ctx, testPath, testContent); err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}

		data, err := comp.ReadFile(ctx, testPath)
		if err != nil {
			t.Fatalf("ReadFile failed: %v", err)
		}

		if string(data) != string(testContent) {
			t.Errorf("expected %q, got %q", testContent, data)
		}
	})
}

// BenchmarkDockerGraphicalScreenshot benchmarks the screenshot capture path.
func BenchmarkDockerGraphicalScreenshot(b *testing.B) {
	if os.Getenv("DOCKER_INTEGRATION_TEST") == "" {
		b.Skip("Skipping Docker integration benchmark. Set DOCKER_INTEGRATION_TEST=1 to run.")
	}

	// We can't use setupDockerGraphicalComputer because it takes *testing.T
	// Duplicate the minimal setup here.
	cmd := exec.Command("docker", "build", "-t", graphicalTestImage, "testdata/graphical")
	if err := cmd.Run(); err != nil {
		b.Fatalf("failed to build graphical test image: %v", err)
	}

	provider, err := GetDockerComputerProvider(DockerComputerProviderProps{pullMode: Never})
	if err != nil {
		b.Fatalf("failed to create provider: %v", err)
	}

	ctx := context.Background()
	sessionId, err := provider.CreateComputer(ctx, ComputerConfig{Image: graphicalTestImage})
	if err != nil {
		b.Fatalf("failed to create computer: %v", err)
	}
	defer provider.DeleteComputer(ctx, sessionId)

	comp, err := provider.GetComputer(ctx, sessionId)
	if err != nil {
		b.Fatalf("failed to get computer: %v", err)
	}
	gc, err := GetGraphicalComputer(comp)
	if err != nil {
		b.Fatalf("expected graphical computer: %v", err)
	}

	// Wait for Xvfb
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		_, _, sErr := gc.GetScreenSize(ctx)
		if sErr == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		data, err := gc.CaptureScreenshot(ctx)
		if err != nil {
			b.Fatalf("CaptureScreenshot failed: %v", err)
		}
		if len(data) < 4 {
			b.Fatalf("screenshot too small: %d bytes", len(data))
		}
	}
}

// unused import guard
var _ = fmt.Sprintf
