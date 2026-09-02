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

type TlsConfig struct {
	TlsCertificate         string `yaml:"tlsCertificate,omitempty"`
	TlsCertificateKey      string `yaml:"tlsCertificateKey,omitempty"`
	TlsTrustedCertificates string `yaml:"tlsTrustedCertificates,omitempty"`
}

func (t TlsConfig) IsEnabled() bool {
	return t.TlsCertificate != "" || t.TlsCertificateKey != ""
}

func (t TlsConfig) IsMTLSEnabled() bool {
	return t.TlsTrustedCertificates != ""
}

type ServerSecurityConfig struct {
	ApiKey string    `yaml:"apiKey,omitempty"`
	Tls    TlsConfig `yaml:"tls,omitempty"`
}

func (s ServerSecurityConfig) HasAPIKey() bool {
	return s.ApiKey != ""
}

func (s ServerSecurityConfig) HasTLS() bool {
	return s.Tls.IsEnabled()
}

func (s ServerSecurityConfig) HasMTLS() bool {
	return s.Tls.IsMTLSEnabled()
}

type ServerNetworkConfig struct {
	Host     string               `yaml:"host,omitempty"`
	Port     int                  `yaml:"port,omitempty"`
	Security ServerSecurityConfig `yaml:"security,omitempty"`
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

	sec := raw.Server.Security
	sec.ApiKey = os.ExpandEnv(sec.ApiKey)
	sec.Tls.TlsCertificate = os.ExpandEnv(sec.Tls.TlsCertificate)
	sec.Tls.TlsCertificateKey = os.ExpandEnv(sec.Tls.TlsCertificateKey)
	sec.Tls.TlsTrustedCertificates = os.ExpandEnv(sec.Tls.TlsTrustedCertificates)

	if sec.Tls.TlsCertificate != "" && sec.Tls.TlsCertificateKey == "" {
		return fmt.Errorf("tlsCertificate is specified but tlsCertificateKey is missing")
	}
	if sec.Tls.TlsCertificateKey != "" && sec.Tls.TlsCertificate == "" {
		return fmt.Errorf("tlsCertificateKey is specified but tlsCertificate is missing")
	}
	if sec.Tls.TlsTrustedCertificates != "" && (sec.Tls.TlsCertificate == "" || sec.Tls.TlsCertificateKey == "") {
		return fmt.Errorf("tlsTrustedCertificates (mTLS) requires both tlsCertificate and tlsCertificateKey to be specified")
	}

	raw.Server.Security = sec

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
