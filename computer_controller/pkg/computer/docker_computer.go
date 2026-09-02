package computer

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"golang.org/x/sync/singleflight"
)

type DockerComputerProvider struct {
	// mutex
	mu sync.RWMutex
	// docker client
	apiClient *client.Client
	// map from user generated session id to docker container id
	computers map[string]string
	// pull options
	pullPolicy config.ImagePullPolicy
}

type DockerComputerProviderProps struct {
	pullPolicy config.ImagePullPolicy
	ops        []client.Opt
}

// Retrieve a computer provider from the environment variable
func GetDockerComputerProvider(props DockerComputerProviderProps) (IComputerProvider, error) {
	apiClient, err := client.New(props.ops...)

	if err != nil {
		return nil, err
	}

	return &DockerComputerProvider{
		sync.RWMutex{},
		apiClient,
		make(map[string]string),
		props.pullPolicy,
	}, nil
}

var pullGroup singleflight.Group

func (provider *DockerComputerProvider) pullImage(ctx context.Context, image string) error {

	// switch case
	switch provider.pullPolicy {
	case config.Always:
		// try pulling image
		out, err := provider.apiClient.ImagePull(ctx, image, client.ImagePullOptions{})
		// return error if not nil
		if err != nil {
			return fmt.Errorf("failed to pull image %s: %w", image, err)
		}
		defer out.Close()

		// copy image container logs
		io.Copy(os.Stdout, out)
	case config.IfNotPresent:
		// use singleFlight
		_, err := provider.apiClient.ImageInspect(ctx, image)

		// image cached locally
		if err == nil {
			return nil
		}

		_, err, _ = pullGroup.Do(image, func() (interface{}, error) {
			// try pulling image
			out, err := provider.apiClient.ImagePull(ctx, image, client.ImagePullOptions{})
			if err != nil {
				return nil, err
			}
			defer out.Close()

			// copy image container logs
			io.Copy(os.Stdout, out)

			return nil, nil
		})

		// return error if not nil
		if err != nil {
			return fmt.Errorf("failed to pull image %s: %w", image, err)
		}

	case config.Never:
	}

	return nil
}

func (provider *DockerComputerProvider) CreateComputer(ctx context.Context, config ComputerConfig) (string, error) {

	// pull the image
	provider.pullImage(ctx, config.Image)

	// create the container, resp contains container id
	// override CMD with "sleep infinity" to keep the container alive as a sandbox
	// for exec and copy operations. Without this, base images (e.g. alpine) exit
	// immediately because their default shell has no TTY.
	resp, err := provider.apiClient.ContainerCreate(ctx, client.ContainerCreateOptions{
		Image: config.Image,
		Config: &container.Config{
			Cmd:       []string{"sleep", "infinity"},
			OpenStdin: true,
		},
	})

	if err != nil {
		return "", fmt.Errorf("failed to create container with image %s: %w", config.Image, err)
	}

	// start the container so exec and copy operations can work
	_, err = provider.apiClient.ContainerStart(ctx, resp.ID, client.ContainerStartOptions{})

	if err != nil {
		return "", fmt.Errorf("failed to start container %s: %w", resp.ID, err)
	}

	// generate random text for session id
	sessionID := rand.Text()

	// lock mutex, set the session id to the container id, unlock mutex
	provider.mu.Lock()
	defer provider.mu.Unlock()
	provider.computers[sessionID] = resp.ID

	return sessionID, nil
}

func (provider *DockerComputerProvider) GetComputer(ctx context.Context, sessionId string) (IComputer, error) {
	// Lock, grab container id and whether exists, unlock
	provider.mu.RLock()
	containerId, exists := provider.computers[sessionId]
	provider.mu.RUnlock()

	// if not exists
	if !exists {
		return nil, fmt.Errorf("computer not found for sessionId %s (it may have been reaped due to inactivity or deleted)", sessionId)
	}

	// Detect if the container supports graphics via DISPLAY env var.
	// If so, return a DockerGraphicalComputer that also implements IGraphicalComputer.
	if display, ok := detectContainerDisplay(ctx, provider.apiClient, containerId); ok {
		return &DockerGraphicalComputer{
			DockerComputer: DockerComputer{
				sessionId:   sessionId,
				containerId: containerId,
				apiClient:   provider.apiClient,
			},
			display: display,
		}, nil
	} else {
		return &DockerComputer{
			sessionId:   sessionId,
			containerId: containerId,
			apiClient:   provider.apiClient,
		}, nil
	}
}

func (provider *DockerComputerProvider) DeleteComputer(ctx context.Context, sessionId string) error {
	// acquire lock, check if session exists, if exists stop and remove container
	provider.mu.Lock()

	// grab the container id and whether it exists or not
	containerId, exists := provider.computers[sessionId]

	if !exists {
		provider.mu.Unlock()
		return nil
	}

	// remove from map
	delete(provider.computers, sessionId)
	provider.mu.Unlock()

	// container stop timeout before killing
	// TODO: make configurable DockerComputerProviderProps
	timeout := 10

	// stop container
	_, err := provider.apiClient.ContainerStop(ctx, containerId, client.ContainerStopOptions{Timeout: &timeout})

	if err != nil {
		return fmt.Errorf("failed to stop container: %w", err)
	}

	// remove container
	_, err = provider.apiClient.ContainerRemove(ctx, containerId, client.ContainerRemoveOptions{
		RemoveVolumes: true,
		Force:         true,
	})

	if err != nil {
		return fmt.Errorf("failed to remove container: %w", err)
	}

	return nil
}

func (provider *DockerComputerProvider) Close() error {
	return provider.apiClient.Close()
}

// implementation of the docker computer
type DockerComputer struct {
	sessionId   string
	containerId string
	apiClient   *client.Client

	// cached user/group info from ContainerInspect (never changes during container lifetime)
	userOnce  sync.Once
	cachedUID string
	cachedGID string
}

func (computer *DockerComputer) GetSessionId() string {
	return computer.sessionId
}

/// Implements IComputer

func (computer *DockerComputer) Execute(ctx context.Context, execInput ExecInput) (*ExecResult, error) {
	// build the command args, mirroring LocalComputer's shell handling
	var cmd []string

	if execInput.Shell != nil && *execInput.Shell == "" {
		// execute directly without a shell
		cmd = []string{execInput.Command}
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
		cmd = append([]string{shell}, args...)
	}

	// build environment variables in KEY=VALUE format
	var env []string
	if execInput.Env != nil {
		for _, e := range execInput.Env {
			env = append(env, fmt.Sprintf("%s=%s", e.Name, e.Value))
		}
	}

	// set working directory
	var workingDir string
	if execInput.Cwd != nil {
		workingDir = *execInput.Cwd
	}

	// create the exec configuration
	execCreateResult, err := computer.apiClient.ExecCreate(ctx, computer.containerId, client.ExecCreateOptions{
		Cmd:          cmd,
		Env:          env,
		WorkingDir:   workingDir,
		AttachStdout: true,
		AttachStderr: true,
		AttachStdin:  execInput.Stdin != nil,
	})

	if err != nil {
		return nil, fmt.Errorf("failed to create exec: %w", err)
	}

	// attach to the exec to get the hijacked connection for I/O
	attachResult, err := computer.apiClient.ExecAttach(ctx, execCreateResult.ID, client.ExecAttachOptions{})

	if err != nil {
		return nil, fmt.Errorf("failed to attach exec: %w", err)
	}
	defer attachResult.Close()

	// if stdin is provided, write it and close the write side
	if execInput.Stdin != nil {
		_, err := io.WriteString(attachResult.Conn, *execInput.Stdin)
		if err != nil {
			return nil, fmt.Errorf("failed to write stdin: %w", err)
		}
		// close write side so the command knows stdin is done
		attachResult.CloseWrite()
	}

	// demux stdout and stderr from the multiplexed stream
	var stdoutBuf, stderrBuf bytes.Buffer
	_, err = stdcopy.StdCopy(&stdoutBuf, &stderrBuf, attachResult.Reader)

	if err != nil {
		return nil, fmt.Errorf("failed to read exec output: %w", err)
	}

	// inspect exec to get the exit code
	inspectResult, err := computer.apiClient.ExecInspect(ctx, execCreateResult.ID, client.ExecInspectOptions{})

	if err != nil {
		return nil, fmt.Errorf("failed to inspect exec: %w", err)
	}

	return &ExecResult{
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		ExitCode: inspectResult.ExitCode,
	}, nil
}

func (computer *DockerComputer) ReadFile(ctx context.Context, filePath string) ([]byte, error) {
	// copy the file out of the container as a tar stream
	copyResult, err := computer.apiClient.CopyFromContainer(ctx, computer.containerId, client.CopyFromContainerOptions{
		SourcePath: filePath,
	})

	if err != nil {
		return nil, fmt.Errorf("failed to copy file from container: %w", err)
	}
	defer copyResult.Content.Close()

	// read the tar stream to extract the file contents
	tr := tar.NewReader(copyResult.Content)

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read tar stream: %w", err)
		}

		// skip directories, we only want the file
		if header.Typeflag == tar.TypeDir {
			continue
		}

		// read the file contents
		content, err := io.ReadAll(tr)
		if err != nil {
			return nil, fmt.Errorf("failed to read file content from tar: %w", err)
		}
		return content, nil
	}

	return nil, fmt.Errorf("file not found in tar stream: %s", filePath)
}

func (computer *DockerComputer) WriteFile(ctx context.Context, filePath string, content []byte) error {
	// create a tar archive containing the file
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	// add the file to the tar archive using just the base name
	header := &tar.Header{
		Name: filepath.Base(filePath),
		Mode: 0644,
		Size: int64(len(content)),
	}

	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("failed to write tar header: %w", err)
	}

	if _, err := tw.Write(content); err != nil {
		return fmt.Errorf("failed to write tar content: %w", err)
	}

	if err := tw.Close(); err != nil {
		return fmt.Errorf("failed to close tar writer: %w", err)
	}

	// copy the tar archive into the container at the parent directory
	_, err := computer.apiClient.CopyToContainer(ctx, computer.containerId, client.CopyToContainerOptions{
		DestinationPath:           filepath.Dir(filePath),
		Content:                   &buf,
		AllowOverwriteDirWithFile: true,
	})

	if err != nil {
		return fmt.Errorf("failed to copy file to container: %w", err)
	}

	return nil
}

func (computer *DockerComputer) ListDirectory(ctx context.Context, dirPath string) ([]FileInfo, error) {
	// copy the directory from the container as a tar stream
	copyResult, err := computer.apiClient.CopyFromContainer(ctx, computer.containerId, client.CopyFromContainerOptions{
		SourcePath: dirPath,
	})

	if err != nil {
		return nil, fmt.Errorf("failed to copy directory from container: %w", err)
	}
	defer copyResult.Content.Close()

	// iterate tar headers to list directory contents
	// the first entry is the directory itself, followed by its contents recursively
	tr := tar.NewReader(copyResult.Content)

	// the base name of the directory in the tar (e.g. "mydir/")
	baseName := filepath.Base(dirPath)

	var fileInfos []FileInfo

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read tar header: %w", err)
		}

		// clean the header name and remove trailing slash
		name := strings.TrimSuffix(header.Name, "/")

		// skip the root directory entry itself
		if name == baseName || name == "." {
			continue
		}

		// only include direct children (depth 1)
		// the tar entry names are relative to the copied directory, e.g. "mydir/file.txt", "mydir/subdir/nested.txt"
		// strip the base directory prefix to get the relative path
		relPath := strings.TrimPrefix(name, baseName+"/")
		// if relPath still contains a separator, it's a nested entry — skip it
		if strings.Contains(relPath, "/") {
			continue
		}

		isDir := header.Typeflag == tar.TypeDir
		var size int64
		if !isDir {
			size = header.Size
		}

		fileInfos = append(fileInfos, FileInfo{
			Name:  filepath.Base(relPath),
			IsDir: isDir,
			Size:  size,
		})
	}

	return fileInfos, nil
}

func (computer *DockerComputer) GetUserId() (string, error) {
	computer.ensureUserCached()
	return computer.cachedUID, nil
}

func (computer *DockerComputer) GetGroupId() (string, error) {
	computer.ensureUserCached()
	return computer.cachedGID, nil
}

// ensureUserCached inspects the container's Config.User once and caches the parsed uid/gid.
// Returns ("0", "0") for empty/default (root), parses "uid:gid" format, and handles
// single uid/username values.
func (computer *DockerComputer) ensureUserCached() {
	computer.userOnce.Do(func() {
		// default to root
		computer.cachedUID = "0"
		computer.cachedGID = "0"

		inspectResult, err := computer.apiClient.ContainerInspect(context.Background(), computer.containerId, client.ContainerInspectOptions{})
		if err != nil || inspectResult.Container.Config == nil {
			return
		}

		user := inspectResult.Container.Config.User
		if user == "" {
			return
		}

		// check for uid:gid or username:groupname format
		if parts := strings.SplitN(user, ":", 2); len(parts) == 2 {
			computer.cachedUID = parts[0]
			computer.cachedGID = parts[1]
			return
		}

		// single value — uid or username, default group to "0"
		computer.cachedUID = user
	})
}
