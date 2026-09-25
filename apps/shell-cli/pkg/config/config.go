package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config holds persistent user configuration for the Shell CLI.
type Config struct {
	AgentHarnessURI string   `yaml:"agent_harness_uri" json:"agent_harness_uri"`
	OAuthIssuerURI  string   `yaml:"oauth_issuer_uri" json:"oauth_issuer_uri"`
	OAuthClientID   string   `yaml:"oauth_client_id" json:"oauth_client_id"`
	OAuthScopes     []string `yaml:"oauth_scopes" json:"oauth_scopes"`
	DefaultMode     string   `yaml:"default_mode" json:"default_mode"`
	Theme           string   `yaml:"theme" json:"theme"`
}

// DefaultConfig returns a Config struct initialized with default values.
func DefaultConfig() *Config {
	return &Config{
		AgentHarnessURI: "http://localhost:3000",
		OAuthIssuerURI:  "http://localhost:8080/oauth",
		OAuthClientID:   "byoai-shell-cli",
		OAuthScopes:     []string{"openid", "profile", "email", "agent:read", "agent:write"},
		DefaultMode:     "interactive",
		Theme:           "dark",
	}
}

// GetDefaultConfigDir returns the ~/.byoai path.
func GetDefaultConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("unable to determine user home directory: %w", err)
	}
	return filepath.Join(home, ".byoai"), nil
}

// GetDefaultConfigPath returns ~/.byoai/config.yaml.
func GetDefaultConfigPath() (string, error) {
	dir, err := GetDefaultConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.yaml"), nil
}

// ConfigExists checks if the configuration file at the given path exists.
func ConfigExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

// LoadConfig loads configuration from a YAML file.
func LoadConfig(path string) (*Config, error) {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = GetDefaultConfigPath()
		if err != nil {
			return nil, err
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file at %s: %w", path, err)
	}

	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse yaml config: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return cfg, nil
}

// SaveConfig writes the configuration to the specified YAML file path, creating parent dirs if needed.
func SaveConfig(path string, cfg *Config) error {
	if cfg == nil {
		return errors.New("cannot save nil config")
	}

	if strings.TrimSpace(path) == "" {
		var err error
		path, err = GetDefaultConfigPath()
		if err != nil {
			return err
		}
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create config directory %s: %w", dir, err)
	}

	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("failed to serialize config to YAML: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("failed to write config file %s: %w", path, err)
	}

	return nil
}

// Validate ensures required settings are present and valid.
func (c *Config) Validate() error {
	if strings.TrimSpace(c.AgentHarnessURI) == "" {
		return errors.New("agent_harness_uri cannot be empty")
	}
	if strings.TrimSpace(c.OAuthIssuerURI) == "" {
		return errors.New("oauth_issuer_uri cannot be empty")
	}
	if strings.TrimSpace(c.OAuthClientID) == "" {
		return errors.New("oauth_client_id cannot be empty")
	}
	if c.DefaultMode != "interactive" && c.DefaultMode != "non-interactive" {
		return fmt.Errorf("invalid default_mode '%s', must be 'interactive' or 'non-interactive'", c.DefaultMode)
	}
	return nil
}
