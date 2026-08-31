package computer

import (
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/client"
)

// DockerGraphicalComputer extends DockerComputer with GUI automation capabilities.
// It implements IGraphicalComputer by executing X11 tools (xdotool, maim, xclip)
// inside the container via docker exec.
type DockerGraphicalComputer struct {
	DockerComputer
	// The DISPLAY value detected from the container (e.g. ":0", ":99")
	display string
}

// Compile-time static assertion ensuring interface implementation.
var _ IGraphicalComputer = &DockerGraphicalComputer{}

// executeRawBinary runs a command inside the container and returns the raw
// binary stdout as []byte. This bypasses the string-based Execute() to avoid
// UTF-8 corruption of binary data (e.g. PNG screenshots).
func (c *DockerGraphicalComputer) executeRawBinary(ctx context.Context, cmd []string) ([]byte, error) {
	env := []string{fmt.Sprintf("DISPLAY=%s", c.display)}

	execCreateResult, err := c.apiClient.ExecCreate(ctx, c.containerId, client.ExecCreateOptions{
		Cmd:          cmd,
		Env:          env,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create exec: %w", err)
	}

	attachResult, err := c.apiClient.ExecAttach(ctx, execCreateResult.ID, client.ExecAttachOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to attach exec: %w", err)
	}
	defer attachResult.Close()

	var stdoutBuf, stderrBuf bytes.Buffer
	_, err = stdcopy.StdCopy(&stdoutBuf, &stderrBuf, attachResult.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read exec output: %w", err)
	}

	inspectResult, err := c.apiClient.ExecInspect(ctx, execCreateResult.ID, client.ExecInspectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to inspect exec: %w", err)
	}

	if inspectResult.ExitCode != 0 {
		return nil, fmt.Errorf("command exited with code %d: %s", inspectResult.ExitCode, stderrBuf.String())
	}

	return stdoutBuf.Bytes(), nil
}

// executeGraphical runs a shell command inside the container with the DISPLAY
// env var set and returns the ExecResult. Used for text-output graphical commands.
func (c *DockerGraphicalComputer) executeGraphical(ctx context.Context, command string) (*ExecResult, error) {
	env := []EnvVar{{Name: "DISPLAY", Value: c.display}}
	return c.Execute(ctx, ExecInput{
		Command: command,
		Env:     &env,
	})
}

// executeGraphicalNoOutput runs a shell command inside the container with the
// DISPLAY env var set and returns only an error. Used for fire-and-forget
// graphical commands (click, type, etc.)
func (c *DockerGraphicalComputer) executeGraphicalNoOutput(ctx context.Context, command string) error {
	result, err := c.executeGraphical(ctx, command)
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("command exited with code %d: %s", result.ExitCode, result.Stderr)
	}
	return nil
}

// CaptureScreenshot captures the desktop screenshot as PNG bytes.
// Tries maim, scrot, and import in order.
func (c *DockerGraphicalComputer) CaptureScreenshot(ctx context.Context) ([]byte, error) {
	tools := [][]string{
		{"maim", "-u"},
		{"scrot", "-z", "-"},
		{"import", "-window", "root", "png:-"},
	}

	for _, toolArgs := range tools {
		data, err := c.executeRawBinary(ctx, toolArgs)
		if err == nil && len(data) > 0 {
			return data, nil
		}
	}

	return nil, fmt.Errorf("failed to capture screenshot: no working screenshot tool found (maim, scrot, import)")
}

// Click performs a mouse click at coordinates (x, y) with specified button ("left", "middle", "right").
func (c *DockerGraphicalComputer) Click(ctx context.Context, x, y int, button string) error {
	btnNum := "1"
	switch strings.ToLower(button) {
	case "left", "1":
		btnNum = "1"
	case "middle", "2":
		btnNum = "2"
	case "right", "3":
		btnNum = "3"
	}

	cmd := fmt.Sprintf("xdotool mousemove --sync %d %d click %s", x, y, btnNum)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// Type types the specified text into the active window.
func (c *DockerGraphicalComputer) Type(ctx context.Context, text string) error {
	cmd := fmt.Sprintf("xdotool type --clearmodifiers -- %q", text)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// PressKey presses a key down.
func (c *DockerGraphicalComputer) PressKey(ctx context.Context, key string) error {
	cmd := fmt.Sprintf("xdotool keydown %s", key)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// ReleaseKey releases a key.
func (c *DockerGraphicalComputer) ReleaseKey(ctx context.Context, key string) error {
	cmd := fmt.Sprintf("xdotool keyup %s", key)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// PressAndHoldKey presses and holds down a key.
func (c *DockerGraphicalComputer) PressAndHoldKey(ctx context.Context, key string) error {
	return c.PressKey(ctx, key)
}

// ReleaseAllKeys releases all modifier and active keys.
func (c *DockerGraphicalComputer) ReleaseAllKeys(ctx context.Context) error {
	return c.executeGraphicalNoOutput(ctx, "xdotool keyup --all")
}

// Drag moves mouse from (x1, y1) to (x2, y2) while holding down left mouse button.
func (c *DockerGraphicalComputer) Drag(ctx context.Context, x1, y1, x2, y2 int) error {
	cmd := fmt.Sprintf("xdotool mousemove --sync %d %d mousedown 1 mousemove --sync %d %d mouseup 1",
		x1, y1, x2, y2)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// MoveMouseTo positions the cursor at (x, y).
func (c *DockerGraphicalComputer) MoveMouseTo(ctx context.Context, x, y int) error {
	cmd := fmt.Sprintf("xdotool mousemove --sync %d %d", x, y)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// Scroll scrolls the mouse wheel vertically by dy and horizontally by dx.
func (c *DockerGraphicalComputer) Scroll(ctx context.Context, dx, dy int) error {
	// Vertical scroll: button 4 (up, dy < 0) / button 5 (down, dy > 0)
	if dy != 0 {
		btn := "5"
		repeat := dy
		if dy < 0 {
			btn = "4"
			repeat = -dy
		}
		cmd := fmt.Sprintf("xdotool click --repeat %d %s", repeat, btn)
		if err := c.executeGraphicalNoOutput(ctx, cmd); err != nil {
			return err
		}
	}

	// Horizontal scroll: button 6 (left, dx < 0) / button 7 (right, dx > 0)
	if dx != 0 {
		btn := "7"
		repeat := dx
		if dx < 0 {
			btn = "6"
			repeat = -dx
		}
		cmd := fmt.Sprintf("xdotool click --repeat %d %s", repeat, btn)
		if err := c.executeGraphicalNoOutput(ctx, cmd); err != nil {
			return err
		}
	}

	return nil
}

// GetClipboard reads text from system clipboard.
func (c *DockerGraphicalComputer) GetClipboard(ctx context.Context) (string, error) {
	result, err := c.executeGraphical(ctx, "xclip -selection clipboard -o")
	if err != nil {
		return "", fmt.Errorf("failed to get clipboard: %w", err)
	}
	if result.ExitCode != 0 {
		return "", fmt.Errorf("failed to get clipboard: %s", result.Stderr)
	}
	return result.Stdout, nil
}

// SetClipboard writes text to system clipboard.
func (c *DockerGraphicalComputer) SetClipboard(ctx context.Context, text string) error {
	env := []EnvVar{{Name: "DISPLAY", Value: c.display}}
	stdin := text
	return func() error {
		result, err := c.Execute(ctx, ExecInput{
			Command: "xclip -selection clipboard",
			Env:     &env,
			Stdin:   &stdin,
		})
		if err != nil {
			return fmt.Errorf("failed to set clipboard: %w", err)
		}
		if result.ExitCode != 0 {
			return fmt.Errorf("failed to set clipboard: %s", result.Stderr)
		}
		return nil
	}()
}

// GetScreenSize returns display resolution (width, height).
func (c *DockerGraphicalComputer) GetScreenSize(ctx context.Context) (int, int, error) {
	result, err := c.executeGraphical(ctx, "xdotool getdisplaygeometry")
	if err != nil {
		return 0, 0, fmt.Errorf("failed to get screen geometry: %w", err)
	}
	if result.ExitCode != 0 {
		return 0, 0, fmt.Errorf("failed to get screen geometry: %s", result.Stderr)
	}

	parts := strings.Fields(strings.TrimSpace(result.Stdout))
	if len(parts) < 2 {
		return 0, 0, fmt.Errorf("invalid display geometry output: %q", result.Stdout)
	}

	w, err1 := strconv.Atoi(parts[0])
	h, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, 0, fmt.Errorf("failed to parse display geometry: %v, %v", err1, err2)
	}

	return w, h, nil
}

// detectContainerDisplay inspects a running container's environment to find the
// DISPLAY variable. It first checks the image/container config env, then falls
// back to exec'ing `echo $DISPLAY` inside the container.
// Returns the display value (e.g. ":99") and true if found, or "" and false if not.
func detectContainerDisplay(ctx context.Context, apiClient *client.Client, containerId string) (string, bool) {
	// (a) Check container config env (catches ENV DISPLAY=:99 from Dockerfile)
	inspectResult, err := apiClient.ContainerInspect(ctx, containerId, client.ContainerInspectOptions{})
	if err == nil && inspectResult.Container.Config != nil {
		for _, envStr := range inspectResult.Container.Config.Env {
			if strings.HasPrefix(envStr, "DISPLAY=") {
				val := strings.TrimPrefix(envStr, "DISPLAY=")
				if val != "" {
					return val, true
				}
			}
		}
	}

	// (b) Fallback: exec echo $DISPLAY inside the container
	// This catches images that set DISPLAY dynamically in entrypoint/init scripts
	execCreateResult, err := apiClient.ExecCreate(ctx, containerId, client.ExecCreateOptions{
		Cmd:          []string{"sh", "-c", "echo $DISPLAY"},
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return "", false
	}

	attachResult, err := apiClient.ExecAttach(ctx, execCreateResult.ID, client.ExecAttachOptions{})
	if err != nil {
		return "", false
	}
	defer attachResult.Close()

	var stdoutBuf, stderrBuf bytes.Buffer
	_, err = stdcopy.StdCopy(&stdoutBuf, &stderrBuf, attachResult.Reader)
	if err != nil {
		return "", false
	}

	display := strings.TrimSpace(stdoutBuf.String())
	if display != "" {
		return display, true
	}

	return "", false
}
