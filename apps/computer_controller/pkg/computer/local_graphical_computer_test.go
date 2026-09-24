package computer

import (
	"context"
	"os"
	"testing"
)

func TestLocalGraphicalComputerInterface(t *testing.T) {
	ctx := context.Background()
	comp := NewLocalGraphicalComputer("test-session")

	t.Run("GetGraphicalComputer Helper", func(t *testing.T) {
		var baseComp IComputer = comp
		gc, err := GetGraphicalComputer(baseComp)
		if err != nil {
			t.Fatalf("expected GetGraphicalComputer to succeed, got: %v", err)
		}
		if gc.GetSessionId() != "test-session" {
			t.Errorf("expected session id 'test-session', got %q", gc.GetSessionId())
		}
	})

	t.Run("Headless Behavior When DISPLAY is Unset", func(t *testing.T) {
		// Save original DISPLAY
		origDisplay, displaySet := os.LookupEnv("DISPLAY")
		os.Unsetenv("DISPLAY")
		defer func() {
			if displaySet {
				os.Setenv("DISPLAY", origDisplay)
			}
		}()

		if comp.SupportsGraphics() {
			t.Errorf("expected SupportsGraphics to return false when DISPLAY is unset")
		}

		// Verify methods return ErrGraphicsUnsupported when graphics are not supported
		if _, err := comp.CaptureScreenshot(ctx); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for CaptureScreenshot, got: %v", err)
		}

		if err := comp.Click(ctx, 100, 100, "left"); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for Click, got: %v", err)
		}

		if err := comp.Type(ctx, "hello"); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for Type, got: %v", err)
		}

		if err := comp.MoveMouseTo(ctx, 50, 50); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for MoveMouseTo, got: %v", err)
		}

		if err := comp.Drag(ctx, 10, 10, 100, 100); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for Drag, got: %v", err)
		}

		if err := comp.Scroll(ctx, 0, 5); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for Scroll, got: %v", err)
		}

		if _, err := comp.GetClipboard(ctx); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for GetClipboard, got: %v", err)
		}

		if err := comp.SetClipboard(ctx, "text"); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for SetClipboard, got: %v", err)
		}

		if _, _, err := comp.GetScreenSize(ctx); err != ErrGraphicsUnsupported {
			t.Errorf("expected ErrGraphicsUnsupported for GetScreenSize, got: %v", err)
		}
	})

	t.Run("SupportsGraphics When DISPLAY is Set", func(t *testing.T) {
		origDisplay, displaySet := os.LookupEnv("DISPLAY")
		os.Setenv("DISPLAY", ":0")
		defer func() {
			if displaySet {
				os.Setenv("DISPLAY", origDisplay)
			} else {
				os.Unsetenv("DISPLAY")
			}
		}()

		if !comp.SupportsGraphics() {
			t.Errorf("expected SupportsGraphics to return true when DISPLAY is set")
		}
	})
}
