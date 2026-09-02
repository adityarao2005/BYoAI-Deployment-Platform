package computer

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/moby/moby/client"
)

func GetComputerProvider(server_config *config.ServerConfig) (IComputerProvider, error) {
	if server_config == nil {
		return nil, fmt.Errorf("server_config cannot be nil")
	}

	var baseProvider IComputerProvider
	var idleTimeout time.Duration

	switch server_config.Type {
	case config.TypeLocal:
		fmt.Printf("warning: computer provider chosen by configuration in computer.yaml detected as Local. Local computers are not best practice if not used carefully and not sandboxed properly. Consider yourself warned.")

		return LocalComputerProvider{}, nil

	case config.TypeDocker:
		spec, ok := server_config.Spec.(config.DockerSpec)
		if !ok {
			return nil, fmt.Errorf("expected DockerSpec for type %q, got %T", config.TypeDocker, server_config.Spec)
		}

		opts := []client.Opt{client.FromEnv}
		if spec.Host != "" {
			opts = append(opts, client.WithHost(spec.Host))
		}
		if spec.APIVersion != "" {
			opts = append(opts, client.WithAPIVersion(spec.APIVersion))
		}
		if spec.CertPath != "" {
			opts = append(opts, client.WithTLSClientConfig(
				filepath.Join(spec.CertPath, "ca.pem"),
				filepath.Join(spec.CertPath, "cert.pem"),
				filepath.Join(spec.CertPath, "key.pem"),
			))
		}

		dp, err := GetDockerComputerProvider(DockerComputerProviderProps{
			pullPolicy: spec.ImagePullPolicy,
			ops:        opts,
		})
		if err != nil {
			return nil, err
		}
		baseProvider = dp
		idleTimeout = spec.ReapIdleContainersAfter

	default:
		return nil, fmt.Errorf("unsupported computer type: %q", server_config.Type)
	}

	return NewReaperProvider(baseProvider, idleTimeout), nil
}
