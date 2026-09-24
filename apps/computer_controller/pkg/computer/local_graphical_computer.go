package computer

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

var ErrGraphicsUnsupported = errors.New("graphical interface is not supported: DISPLAY environment variable is not set")

// LocalGraphicalComputer extends LocalComputer with GUI automation capabilities.
type LocalGraphicalComputer struct {
	LocalComputer
}

// Compile-time static assertions ensuring interface implementations.
var _ IGraphicalComputer = LocalGraphicalComputer{}

func NewLocalGraphicalComputer(sessionId string) LocalGraphicalComputer {
	return LocalGraphicalComputer{
		LocalComputer: LocalComputer{sessionId: sessionId},
	}
}

// CaptureScreenshot captures the desktop screenshot as PNG byte slice.
func (computer LocalGraphicalComputer) CaptureScreenshot(ctx context.Context) ([]byte, error) {
	if !computer.SupportsGraphics() {
		return nil, ErrGraphicsUnsupported
	}

	// Try maim, scrot, or import in order
	tools := [][]string{
		{"maim", "-u"},
		{"scrot", "-z", "-"},
		{"import", "-window", "root", "png:-"},
	}

	for _, toolArgs := range tools {
		cmd := exec.CommandContext(ctx, toolArgs[0], toolArgs[1:]...)
		var outBuf bytes.Buffer
		cmd.Stdout = &outBuf
		if err := cmd.Run(); err == nil && outBuf.Len() > 0 {
			return outBuf.Bytes(), nil
		}
	}

	return nil, errors.New("failed to capture screenshot: no working screenshot tool found (maim, scrot, import)")
}

// Click performs a mouse click at coordinates (x, y) with specified button ("left", "middle", "right").
func (computer LocalGraphicalComputer) Click(ctx context.Context, x, y int, button string) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	btnNum := "1"
	switch strings.ToLower(button) {
	case "left", "1":
		btnNum = "1"
	case "middle", "2":
		btnNum = "2"
	case "right", "3":
		btnNum = "3"
	default:
		btnNum = "1"
	}

	cmd := exec.CommandContext(ctx, "xdotool", "mousemove", "--sync", strconv.Itoa(x), strconv.Itoa(y), "click", btnNum)
	return cmd.Run()
}

// Type types the specified text into the active window.
func (computer LocalGraphicalComputer) Type(ctx context.Context, text string) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xdotool", "type", "--clearmodifiers", "--", text)
	return cmd.Run()
}

// PressKey presses a key down.
func (computer LocalGraphicalComputer) PressKey(ctx context.Context, key string) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xdotool", "keydown", key)
	return cmd.Run()
}

// ReleaseKey releases a key.
func (computer LocalGraphicalComputer) ReleaseKey(ctx context.Context, key string) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xdotool", "keyup", key)
	return cmd.Run()
}

// PressAndHoldKey presses and holds down a key.
func (computer LocalGraphicalComputer) PressAndHoldKey(ctx context.Context, key string) error {
	return computer.PressKey(ctx, key)
}

// ReleaseAllKeys releases all modifier and active keys.
func (computer LocalGraphicalComputer) ReleaseAllKeys(ctx context.Context) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xdotool", "keyup", "Shift_L", "Shift_R", "Control_L", "Control_R", "Alt_L", "Alt_R", "Meta_L", "Meta_R", "Super_L", "Super_R")
	return cmd.Run()
}

// Drag moves mouse from (x1, y1) to (x2, y2) while holding down left mouse button.
func (computer LocalGraphicalComputer) Drag(ctx context.Context, x1, y1, x2, y2 int) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xdotool", "mousemove", "--sync", strconv.Itoa(x1), strconv.Itoa(y1), "mousedown", "1", "mousemove", "--sync", strconv.Itoa(x2), strconv.Itoa(y2), "mouseup", "1")
	return cmd.Run()
}

// MoveMouseTo positions the cursor at (x, y).
func (computer LocalGraphicalComputer) MoveMouseTo(ctx context.Context, x, y int) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xdotool", "mousemove", "--sync", strconv.Itoa(x), strconv.Itoa(y))
	return cmd.Run()
}

// Scroll scrolls the mouse wheel vertically by dy and horizontally by dx.
func (computer LocalGraphicalComputer) Scroll(ctx context.Context, dx, dy int) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	// Vertical scroll: button 4 (up, dy < 0) / button 5 (down, dy > 0)
	if dy != 0 {
		btn := "5"
		repeat := dy
		if dy < 0 {
			btn = "4"
			repeat = -dy
		}
		cmd := exec.CommandContext(ctx, "xdotool", "click", "--repeat", strconv.Itoa(repeat), btn)
		if err := cmd.Run(); err != nil {
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
		cmd := exec.CommandContext(ctx, "xdotool", "click", "--repeat", strconv.Itoa(repeat), btn)
		if err := cmd.Run(); err != nil {
			return err
		}
	}

	return nil
}

// GetClipboard reads text from system clipboard.
func (computer LocalGraphicalComputer) GetClipboard(ctx context.Context) (string, error) {
	if !computer.SupportsGraphics() {
		return "", ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xclip", "-selection", "clipboard", "-o")
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("failed to get clipboard: %w", err)
	}
	return outBuf.String(), nil
}

// SetClipboard writes text to system clipboard.
func (computer LocalGraphicalComputer) SetClipboard(ctx context.Context, text string) error {
	if !computer.SupportsGraphics() {
		return ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xclip", "-selection", "clipboard")
	cmd.Stdin = strings.NewReader(text)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to set clipboard: %w", err)
	}
	return nil
}

// GetScreenSize returns display resolution (width, height).
func (computer LocalGraphicalComputer) GetScreenSize(ctx context.Context) (int, int, error) {
	if !computer.SupportsGraphics() {
		return 0, 0, ErrGraphicsUnsupported
	}

	cmd := exec.CommandContext(ctx, "xdotool", "getdisplaygeometry")
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	if err := cmd.Run(); err != nil {
		return 0, 0, fmt.Errorf("failed to get screen geometry: %w", err)
	}

	parts := strings.Fields(strings.TrimSpace(outBuf.String()))
	if len(parts) < 2 {
		return 0, 0, fmt.Errorf("invalid display geometry output: %q", outBuf.String())
	}

	w, err1 := strconv.Atoi(parts[0])
	h, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, 0, fmt.Errorf("failed to parse display geometry: %v, %v", err1, err2)
	}

	return w, h, nil
}
