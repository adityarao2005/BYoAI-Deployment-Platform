package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config holds runtime configuration for the API Gateway.
type Config struct {
	AgentHarnessURI string
	JWKSURI         string
	JWTIssuer       string
	JWTAudience     string
	ListenAddr      string
	LogLevel        string
}

// LoadFromEnv loads configuration from environment variables with sensible defaults.
func LoadFromEnv() (*Config, error) {
	cfg := &Config{
		AgentHarnessURI: getEnv("AGENT_HARNESS_URI", "http://localhost:3000"),
		JWKSURI:         getEnv("JWKS_URI", ""),
		JWTIssuer:       getEnv("JWT_ISSUER", ""),
		JWTAudience:     getEnv("JWT_AUDIENCE", ""),
		ListenAddr:      getEnv("LISTEN_ADDR", ":8080"),
		LogLevel:        strings.ToLower(getEnv("LOG_LEVEL", "info")),
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	return cfg, nil
}

// Validate checks that required configuration fields are set and well-formed.
func (c *Config) Validate() error {
	if c.AgentHarnessURI == "" {
		return errors.New("AGENT_HARNESS_URI is required")
	}
	if _, err := url.ParseRequestURI(c.AgentHarnessURI); err != nil {
		return fmt.Errorf("AGENT_HARNESS_URI is not a valid URL: %w", err)
	}

	if c.JWKSURI != "" {
		if _, err := url.ParseRequestURI(c.JWKSURI); err != nil {
			return fmt.Errorf("JWKS_URI is not a valid URL: %w", err)
		}
	}

	if c.ListenAddr == "" {
		return errors.New("LISTEN_ADDR cannot be empty")
	}

	return nil
}

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok && strings.TrimSpace(val) != "" {
		return strings.TrimSpace(val)
	}
	return defaultVal
}
