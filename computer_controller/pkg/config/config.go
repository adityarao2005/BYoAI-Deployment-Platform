package config

import (
	"fmt"
	"os"
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

type ServerConfig struct {
	Type ConfigType `yaml:"type"`
	Spec Spec       `yaml:"-"`
}

func (c *ServerConfig) UnmarshalYAML(value *yaml.Node) error {
	// Intermediate struct to capture top-level fields
	var raw struct {
		Type ConfigType `yaml:"type"`
		Spec yaml.Node  `yaml:"spec"`
	}

	if err := value.Decode(&raw); err != nil {
		return err
	}

	c.Type = raw.Type

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
