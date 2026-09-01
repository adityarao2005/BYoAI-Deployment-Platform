package config

import (
	"fmt"
	"time"

	"go.yaml.in/yaml/v3"
)

type ConfigType string

const (
	TypeLocal  ConfigType = "local"
	TypeDocker ConfigType = "docker"
)

type DockerSpec struct {
	Host                    string        `yaml:"host,omitempty"`
	APIVersion              string        `yaml:"apiVersion,omitempty"`
	CertPath                string        `yaml:"certPath,omitempty"`
	TLSVerify               bool          `yaml:"tlsVerify,omitempty"`
	ImagePullPolicy         string        `yaml:"imagePullPolicy,omitempty"`
	ReapIdleContainersAfter time.Duration `yaml:"reapIdleContainersAfter,omitempty"`
}

type Spec interface {
	isSpec()
}

func (DockerSpec) isSpec() {}

type ComputerConfig struct {
	Type ConfigType `yaml:"type"`
	Spec Spec       `yaml:"-"`
}

func (c *ComputerConfig) UnmarshalYAML(value *yaml.Node) error {
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
		c.Spec = nil

	case TypeDocker:
		var spec DockerSpec
		if !raw.Spec.IsZero() {
			if err := raw.Spec.Decode(&spec); err != nil {
				return fmt.Errorf("failed to parse docker spec: %w", err)
			}
		}
		c.Spec = spec

	default:
		return fmt.Errorf("unsupported computer type: %q", raw.Type)
	}

	return nil
}

func LoadConfig(data []byte) (*ComputerConfig, error) {
	var cfg ComputerConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
