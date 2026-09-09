package computer

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

//// Local Computer

type LocalComputer struct {
	sessionId string
	env       map[string]string
}

/// Implements IComputer

func (computer LocalComputer) Execute(ctx context.Context, execInput ExecInput) (*ExecResult, error) {
	var cmd *exec.Cmd

	if execInput.Shell != nil && *execInput.Shell == "" {
		cmd = exec.CommandContext(ctx, execInput.Command)
	} else {
		shell := "sh"
		if execInput.Shell != nil {
			shell = *execInput.Shell
		}

		var args []string
		if execInput.ShellArgs != nil {
			args = append(args, execInput.ShellArgs...)
		} else {
			args = append(args, "-c")
		}
		args = append(args, execInput.Command)
		cmd = exec.CommandContext(ctx, shell, args...)
	}

	// set the current working directory
	if execInput.Cwd != nil {
		cmd.Dir = *execInput.Cwd
	}

	// for each environment variable, append it to the environment of the command
	var customEnvs []string
	for k, v := range computer.env {
		customEnvs = append(customEnvs, fmt.Sprintf("%s=%s", k, v))
	}
	if execInput.Env != nil {
		for _, value := range execInput.Env {
			customEnvs = append(customEnvs, fmt.Sprintf("%s=%s", value.Name, value.Value))
		}
	}
	if len(customEnvs) > 0 {
		cmd.Env = append(os.Environ(), customEnvs...)
	}

	// set the stdin of the command
	if execInput.Stdin != nil {
		cmd.Stdin = strings.NewReader(*execInput.Stdin)
	}

	// set configurable wait delay if provided
	if execInput.WaitDelay != nil {
		cmd.WaitDelay = *execInput.WaitDelay
	}

	// set the buffers for stdout and stderr
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	// run the command
	err := cmd.Run()
	var exitCode int
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, err
		}
	}

	// return the string values
	return &ExecResult{
		ExitCode: exitCode,
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
	}, nil
}

func (computer LocalComputer) ReadFile(ctx context.Context, filePath string) ([]byte, error) {
	return os.ReadFile(filePath)
}

func (computer LocalComputer) WriteFile(ctx context.Context, filePath string, content []byte) error {
	return os.WriteFile(filePath, content, 0644)
}

// list directories
func (computer LocalComputer) ListDirectory(ctx context.Context, dirPath string) ([]FileInfo, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}
	var fileInfos []FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		var size int64
		if err == nil {
			size = info.Size()
		}
		fileInfos = append(fileInfos, FileInfo{
			Name:  entry.Name(),
			IsDir: entry.IsDir(),
			Size:  size,
		})
	}
	return fileInfos, nil
}

func (computer LocalComputer) GetUserId() (string, error) {
	return strconv.Itoa(os.Getuid()), nil
}

func (computer LocalComputer) GetGroupId() (string, error) {
	return strconv.Itoa(os.Getgid()), nil
}

func (computer LocalComputer) GetSessionId() string {
	return computer.sessionId
}

/// Graphical Components

func (computer LocalComputer) SupportsGraphics() bool {
	_, supported := os.LookupEnv("DISPLAY")
	return supported
}

// singleton instance of LocalComputer with graphical capabilities
var localComputer IComputer = NewLocalGraphicalComputer("0")

//// Local Computer Provider

// local computer provider
type LocalComputerProvider struct {
	mu        sync.RWMutex
	computers map[string]IComputer
}

// Creates a computer given the configuration and returns a "sessionId"
func (provider *LocalComputerProvider) CreateComputer(ctx context.Context, config ComputerConfig) (string, error) {
	sessionID := rand.Text()
	lc := LocalComputer{
		sessionId: sessionID,
		env:       config.Environment,
	}

	var comp IComputer = lc
	if lc.SupportsGraphics() {
		lgc := NewLocalGraphicalComputer(sessionID)
		lgc.env = config.Environment
		comp = lgc
	}

	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.computers == nil {
		provider.computers = make(map[string]IComputer)
	}
	provider.computers[sessionID] = comp

	return sessionID, nil
}

// Retrieves the computer given the "sessionId"
func (provider *LocalComputerProvider) GetComputer(ctx context.Context, sessionId string) (IComputer, error) {
	provider.mu.RLock()
	comp, exists := provider.computers[sessionId]
	provider.mu.RUnlock()

	if exists {
		return comp, nil
	}

	if sessionId == "0" {
		return localComputer, nil
	}

	return nil, fmt.Errorf("computer not found for sessionId %s", sessionId)
}

// Removes the computer from the provider and cleans up the resources
func (provider *LocalComputerProvider) DeleteComputer(ctx context.Context, sessionId string) error {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.computers != nil {
		delete(provider.computers, sessionId)
	}
	return nil
}

func CreateLocalComputerProvider() IComputerProvider {
	return &LocalComputerProvider{
		computers: make(map[string]IComputer),
	}
}
