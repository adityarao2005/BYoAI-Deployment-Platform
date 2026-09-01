package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"time"

	"go.yaml.in/yaml/v3"
)

type ConfigType string

const (
	TypeLocal  ConfigType = "local"
	TypeDocker ConfigType = "docker"
)

type ImagePullPolicy string

const (
	IfNotPresent ImagePullPolicy = "IfNotPresent"
	Never        ImagePullPolicy = "Never"
	Always       ImagePullPolicy = "Always"
)

type DockerSpec struct {
	Host                    string          `yaml:"host,omitempty"`
	APIVersion              string          `yaml:"apiVersion,omitempty"`
	CertPath                string          `yaml:"certPath,omitempty"`
	ImagePullPolicy         ImagePullPolicy `yaml:"imagePullPolicy,omitempty"`
	ReapIdleContainersAfter time.Duration   `yaml:"reapIdleContainersAfter,omitempty"`
}

type Spec interface {
	isSpec()
}

func (DockerSpec) isSpec() {}

type ServerNetworkConfig struct {
	Host string `yaml:"host,omitempty"`
	Port int    `yaml:"port,omitempty"`
}

func (s ServerNetworkConfig) Address() string {
	return net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
}

type ServerConfig struct {
	Type   ConfigType          `yaml:"type"`
	Server ServerNetworkConfig `yaml:"server,omitempty"`
	Spec   Spec                `yaml:"-"`
}

func (c *ServerConfig) UnmarshalYAML(value *yaml.Node) error {
	// Intermediate struct to capture top-level fields
	var raw struct {
		Type   ConfigType          `yaml:"type"`
		Server ServerNetworkConfig `yaml:"server"`
		Spec   yaml.Node           `yaml:"spec"`
	}

	if err := value.Decode(&raw); err != nil {
		return err
	}

	if raw.Server.Host == "" {
		raw.Server.Host = "localhost"
	}
	if raw.Server.Port == 0 {
		raw.Server.Port = 8080
	} else if raw.Server.Port < 1 || raw.Server.Port > 65535 {
		return fmt.Errorf("invalid server port %d: must be between 1 and 65535", raw.Server.Port)
	}

	c.Type = raw.Type
	c.Server = raw.Server

	switch raw.Type {
	case TypeLocal:
		if !raw.Spec.IsZero() {
			return fmt.Errorf("spec is not allowed when type is %q", raw.Type)
		}
		c.Spec = nil

	case TypeDocker:
		var spec DockerSpec
		if !raw.Spec.IsZero() {
			if err := raw.Spec.Decode(&spec); err != nil {
				return fmt.Errorf("failed to parse docker spec: %w", err)
			}
		}
		if spec.ImagePullPolicy == "" {
			spec.ImagePullPolicy = IfNotPresent
		}
		switch spec.ImagePullPolicy {
		case IfNotPresent, Always, Never:
			// valid policy
		default:
			return fmt.Errorf("invalid imagePullPolicy %q: must be one of IfNotPresent, Always, Never", spec.ImagePullPolicy)
		}
		c.Spec = spec

	default:
		return fmt.Errorf("unsupported computer type: %q", raw.Type)
	}

	return nil
}

func LoadConfig(data []byte) (*ServerConfig, error) {
	var cfg ServerConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Loads the config from the file
func LoadConfigFromFile() (*ServerConfig, error) {
	bytes, err := os.ReadFile("computer.yaml")

	if err != nil {
		return nil, err
	}

	return LoadConfig(bytes)
}
