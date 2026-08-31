package computer

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"

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
	pullOption ImagePullOptions
}

// image pull options, default being if not present
type ImagePullOptions int

const (
	IfNotPresent ImagePullOptions = iota
	Always
	Never
)

type DockerComputerProviderProps struct {
	pullMode ImagePullOptions
}

// Retrieve a computer provider from the environment variable
func GetDockerComputerProvider(props DockerComputerProviderProps) (IComputerProvider, error) {
	apiClient, err := client.New(client.FromEnv)

	if err != nil {
		return nil, err
	}

	return &DockerComputerProvider{
		sync.RWMutex{},
		apiClient,
		make(map[string]string),
		props.pullMode,
	}, nil
}

var pullGroup singleflight.Group

func (provider *DockerComputerProvider) pullImage(ctx context.Context, image string) error {

	// switch case
	switch provider.pullOption {
	case Always:
		// try pulling image
		out, err := provider.apiClient.ImagePull(ctx, image, client.ImagePullOptions{})
		// return error if not nil
		if err != nil {
			return fmt.Errorf("failed to pull image %s: %w", image, err)
		}
		defer out.Close()

		// copy image container logs
		io.Copy(os.Stdout, out)
	case IfNotPresent:
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

	case Never:
	}

	return nil
}

func (provider *DockerComputerProvider) CreateComputer(ctx context.Context, config ComputerConfig) (string, error) {

	// pull the image
	provider.pullImage(ctx, config.Image)

	// create the container, resp contains container id
	resp, err := provider.apiClient.ContainerCreate(ctx, client.ContainerCreateOptions{
		Image: config.Image,
	})

	if err != nil {
		return "", fmt.Errorf("failed to create container with image %s: %w", config.Image, err)
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
	// TODO: ..
	return nil, errors.New("TODO:")
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
		Force: true,
	})

	if err != nil {
		return fmt.Errorf("failed to remove container: %w", err)
	}

	return nil
}

func (provider *DockerComputerProvider) Close() error {
	return provider.apiClient.Close()
}

type DockerComputer struct {
}
