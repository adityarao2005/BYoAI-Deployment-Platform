package computer

import (
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// KubernetesGraphicalComputer extends KubernetesComputer with GUI automation capabilities.
// It implements IGraphicalComputer by executing X11 tools (xdotool, maim, xclip)
// inside the sandbox pod via remote execution.
type KubernetesGraphicalComputer struct {
	*KubernetesComputer
	display string
}

// Compile-time assertion ensuring interface implementation.
var _ IGraphicalComputer = &KubernetesGraphicalComputer{}

// detectPodDisplay checks if the sandbox pod defines a DISPLAY environment variable.
func detectPodDisplay(ctx context.Context, clientSet kubernetes.Interface, namespace, podName string) (string, bool) {
	pod, err := clientSet.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return "", false
	}

	for _, container := range pod.Spec.Containers {
		for _, env := range container.Env {
			if env.Name == "DISPLAY" && env.Value != "" {
				return env.Value, true
			}
		}
	}
	return "", false
}

// executeRawBinary runs a command directly inside the pod container with DISPLAY set
// and returns raw binary bytes from stdout without string conversion.
func (c *KubernetesGraphicalComputer) executeRawBinary(ctx context.Context, cmd []string) ([]byte, error) {
	var stdoutBuf, stderrBuf bytes.Buffer

	// Wrap command to export DISPLAY
	wrappedCmd := []string{
		"sh", "-c", fmt.Sprintf("export DISPLAY=%q; exec \"$@\"", c.display),
		"sh",
	}
	wrappedCmd = append(wrappedCmd, cmd...)

	exitCode, err := c.executeCommand(ctx, wrappedCmd, nil, &stdoutBuf, &stderrBuf)
	if err != nil {
		return nil, fmt.Errorf("failed to execute raw binary command: %w", err)
	}
	if exitCode != 0 {
		return nil, fmt.Errorf("command exited with code %d: %s", exitCode, stderrBuf.String())
	}

	return stdoutBuf.Bytes(), nil
}

func (c *KubernetesGraphicalComputer) executeGraphical(ctx context.Context, command string) (*ExecResult, error) {
	env := []EnvVar{{Name: "DISPLAY", Value: c.display}}
	return c.Execute(ctx, ExecInput{
		Command: command,
		Env:     env,
	})
}

func (c *KubernetesGraphicalComputer) executeGraphicalNoOutput(ctx context.Context, command string) error {
	result, err := c.executeGraphical(ctx, command)
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("graphical command exited with code %d: %s", result.ExitCode, result.Stderr)
	}
	return nil
}

// CaptureScreenshot captures the desktop screenshot as PNG bytes.
func (c *KubernetesGraphicalComputer) CaptureScreenshot(ctx context.Context) ([]byte, error) {
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
func (c *KubernetesGraphicalComputer) Click(ctx context.Context, x, y int, button string) error {
	btnNum := "1"
	switch strings.ToLower(button) {
	case "left", "1":
		btnNum = "1"
	case "middle", "2":
		btnNum = "2"
	case "right", "3":
		btnNum = "3"
	}

	cmd := fmt.Sprintf("xdotool mousemove %d %d click %s", x, y, btnNum)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// Type types the specified text into the active window.
func (c *KubernetesGraphicalComputer) Type(ctx context.Context, text string) error {
	cmd := fmt.Sprintf("xdotool type --clearmodifiers -- %q", text)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// PressKey presses a key down.
func (c *KubernetesGraphicalComputer) PressKey(ctx context.Context, key string) error {
	cmd := fmt.Sprintf("xdotool keydown %s", key)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// ReleaseKey releases a key.
func (c *KubernetesGraphicalComputer) ReleaseKey(ctx context.Context, key string) error {
	cmd := fmt.Sprintf("xdotool keyup %s", key)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// PressAndHoldKey presses and holds down a key.
func (c *KubernetesGraphicalComputer) PressAndHoldKey(ctx context.Context, key string) error {
	return c.PressKey(ctx, key)
}

// ReleaseAllKeys releases all modifier and active keys.
func (c *KubernetesGraphicalComputer) ReleaseAllKeys(ctx context.Context) error {
	return c.executeGraphicalNoOutput(ctx, "xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Meta_L Meta_R Super_L Super_R")
}

// Drag moves mouse from (x1, y1) to (x2, y2) while holding down left mouse button.
func (c *KubernetesGraphicalComputer) Drag(ctx context.Context, x1, y1, x2, y2 int) error {
	cmd := fmt.Sprintf("xdotool mousemove %d %d mousedown 1 mousemove %d %d mouseup 1", x1, y1, x2, y2)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// MoveMouseTo positions the cursor at (x, y).
func (c *KubernetesGraphicalComputer) MoveMouseTo(ctx context.Context, x, y int) error {
	cmd := fmt.Sprintf("xdotool mousemove %d %d", x, y)
	return c.executeGraphicalNoOutput(ctx, cmd)
}

// Scroll scrolls the mouse wheel vertically by dy and horizontally by dx.
func (c *KubernetesGraphicalComputer) Scroll(ctx context.Context, dx, dy int) error {
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
func (c *KubernetesGraphicalComputer) GetClipboard(ctx context.Context) (string, error) {
	res, err := c.executeGraphical(ctx, "xclip -selection clipboard -o")
	if err == nil && res.ExitCode == 0 {
		return res.Stdout, nil
	}

	res, err = c.executeGraphical(ctx, "xsel --clipboard --output")
	if err == nil && res.ExitCode == 0 {
		return res.Stdout, nil
	}

	return "", fmt.Errorf("failed to read clipboard (neither xclip nor xsel succeeded)")
}

// SetClipboard sets the system clipboard text.
func (c *KubernetesGraphicalComputer) SetClipboard(ctx context.Context, text string) error {
	env := []EnvVar{{Name: "DISPLAY", Value: c.display}}
	res, err := c.Execute(ctx, ExecInput{
		Command: "xclip -selection clipboard",
		Stdin:   &text,
		Env:     env,
	})
	if err == nil && res.ExitCode == 0 {
		return nil
	}

	res, err = c.Execute(ctx, ExecInput{
		Command: "xsel --clipboard --input",
		Stdin:   &text,
		Env:     env,
	})
	if err == nil && res.ExitCode == 0 {
		return nil
	}

	return fmt.Errorf("failed to set clipboard (neither xclip nor xsel succeeded)")
}

// GetScreenSize returns the current screen width and height in pixels.
func (c *KubernetesGraphicalComputer) GetScreenSize(ctx context.Context) (int, int, error) {
	res, err := c.executeGraphical(ctx, "xdotool getdisplaygeometry")
	if err == nil && res.ExitCode == 0 {
		fields := strings.Fields(res.Stdout)
		if len(fields) >= 2 {
			w, errW := strconv.Atoi(fields[0])
			h, errH := strconv.Atoi(fields[1])
			if errW == nil && errH == nil {
				return w, h, nil
			}
		}
	}

	res, err = c.executeGraphical(ctx, "xdpyinfo")
	if err == nil && res.ExitCode == 0 {
		for _, line := range strings.Split(res.Stdout, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "dimensions:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					parts := strings.Split(fields[1], "x")
					if len(parts) == 2 {
						w, errW := strconv.Atoi(parts[0])
						h, errH := strconv.Atoi(parts[1])
						if errW == nil && errH == nil {
							return w, h, nil
						}
					}
				}
			}
		}
	}

	return 0, 0, fmt.Errorf("failed to get screen size (neither xdotool nor xdpyinfo succeeded)")
}
