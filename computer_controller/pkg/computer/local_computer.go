package computer

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

//// Local Computer

type LocalComputer struct {
	sessionId string
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
			args = append(args, *execInput.ShellArgs...)
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
	if execInput.Env != nil {
		env := *execInput.Env

		for _, value := range env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", value.Name, value.Value))
		}
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
}

// Creates a computer given the configuration and returns a "sessionId"
func (provider LocalComputerProvider) CreateComputer(ctx context.Context, config ComputerConfig) (string, error) {
	return "0", nil
}

// Retrieves the computer given the "sessionId"
func (provider LocalComputerProvider) GetComputer(ctx context.Context, sessionId string) (IComputer, error) {
	return localComputer, nil
}

// Removes the computer from the provider and cleans up the resources
func (provider LocalComputerProvider) DeleteComputer(ctx context.Context, sessionId string) error {
	return nil
}

func CreateLocalComputerProvider() IComputerProvider {
	return LocalComputerProvider{}
}
