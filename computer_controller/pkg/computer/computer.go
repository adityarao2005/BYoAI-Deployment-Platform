package computer

import (
	"context"
	"errors"
	"time"
)

// Result of a command execution to give the AI full context
type ExecResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// environment variables for the command
type EnvVar struct {
	Name  string
	Value string
}

// Input for command execution
type ExecInput struct {
	// The command to execute
	Command string
	// The working directory of the command. If nil, the default working directory is used.
	Cwd *string
	// Environment variables to set for the command. If nil, the default environment variables are used.
	Env []EnvVar
	// Standard input for the command. If nil, no standard input is provided.
	Stdin *string
	// The shell binary or interpreter to use (e.g. "sh", "bash", "python", "psql").
	// If nil, defaults to "sh". If empty string "", command is executed directly.
	Shell *string
	// Optional arguments passed to the shell binary prior to the command string.
	// If nil, defaults are automatically selected based on the shell (e.g. ["-c"]).
	ShellArgs []string
	// Optional configurable wait delay for process completion and pipe closing.
	WaitDelay *time.Duration
}

// File metadata to help the AI navigate
type FileInfo struct {
	Name  string
	IsDir bool
	Size  int64
}

// Basic computer interface with shell capabilities and File I/O
type IComputer interface {
	// Added context for timeouts, and explicit CWD/Env vars, and optional stdin
	Execute(ctx context.Context, execInput ExecInput) (*ExecResult, error)

	// Changed to []byte to support binary files safely
	ReadFile(ctx context.Context, filePath string) ([]byte, error)
	WriteFile(ctx context.Context, filePath string, content []byte) error

	// Returns richer metadata so the agent knows what it's looking at
	ListDirectory(ctx context.Context, dirPath string) ([]FileInfo, error)

	GetUserId() (string, error)
	GetGroupId() (string, error)

	// each computer needs a session id so we can query them per agent
	GetSessionId() string
}

// Graphical computer interface with GUI capabilities and inheriting basic computer
type IGraphicalComputer interface {
	// make IGraphicalComputer inherit IComputer
	IComputer

	// Optional: add a bounding box parameter (x, y, w, h) for cropped screenshots
	CaptureScreenshot(ctx context.Context) ([]byte, error)

	// Added button type (left, right, middle)
	Click(ctx context.Context, x, y int, button string) error
	Type(ctx context.Context, text string) error

	PressKey(ctx context.Context, key string) error
	ReleaseKey(ctx context.Context, key string) error
	PressAndHoldKey(ctx context.Context, key string) error
	ReleaseAllKeys(ctx context.Context) error

	Drag(ctx context.Context, x1, y1, x2, y2 int) error
	MoveMouseTo(ctx context.Context, x, y int) error

	// Changed to deltas (how much to scroll)
	Scroll(ctx context.Context, dx, dy int) error

	GetClipboard(ctx context.Context) (string, error)
	SetClipboard(ctx context.Context, text string) error
	GetScreenSize(ctx context.Context) (int, int, error)
}

// computer configuration for creating a computer
type ComputerConfig struct {
	// docker image to use
	Image string
}

// provides the computer
type IComputerProvider interface {
	// Creates a computer given the configuration and returns a "sessionId"
	CreateComputer(ctx context.Context, config ComputerConfig) (string, error)

	// Retrieves the computer given the "sessionId"
	GetComputer(ctx context.Context, sessionId string) (IComputer, error)

	// Removes the computer from the provider and cleans up the resources
	DeleteComputer(ctx context.Context, sessionId string) error
}

// Utility function for getting the graphical computer from an IComputer
// returns an error if the computer doesn't have graphical capabilities
func GetGraphicalComputer(computer IComputer) (IGraphicalComputer, error) {
	if gc, ok := computer.(IGraphicalComputer); ok {
		return gc, nil
	}
	return nil, errors.New("computer is not a graphical computer")
}
