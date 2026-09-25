package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config holds runtime configuration for the Chat UI server.
type Config struct {
	AgentHarnessURI   string
	OAuthIssuerURI    string
	OAuthClientID     string
	OAuthClientSecret string
	OAuthCallbackPath string
	SessionSecret     string
	ListenAddr        string
	LogLevel          string
}

// LoadFromEnv loads configuration from environment variables with sensible defaults.
func LoadFromEnv() (*Config, error) {
	cfg := &Config{
		AgentHarnessURI:   getEnv("AGENT_HARNESS_URI", "http://localhost:3000"),
		OAuthIssuerURI:    getEnv("OAUTH_ISSUER_URI", "http://localhost:8080/oauth"),
		OAuthClientID:     getEnv("OAUTH_CLIENT_ID", "byoai-chat-ui"),
		OAuthClientSecret: getEnv("OAUTH_CLIENT_SECRET", "dev-secret-change-in-prod"),
		OAuthCallbackPath: getEnv("OAUTH_CALLBACK_PATH", "/auth/callback"),
		SessionSecret:     getEnv("SESSION_SECRET", "default-dev-session-secret-key-32b"),
		ListenAddr:        getEnv("LISTEN_ADDR", ":8081"),
		LogLevel:          strings.ToLower(getEnv("LOG_LEVEL", "info")),
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	return cfg, nil
}

// Validate checks that required configuration fields are set and valid.
func (c *Config) Validate() error {
	if c.AgentHarnessURI == "" {
		return errors.New("AGENT_HARNESS_URI is required")
	}
	if _, err := url.ParseRequestURI(c.AgentHarnessURI); err != nil {
		return fmt.Errorf("AGENT_HARNESS_URI is not a valid URL: %w", err)
	}

	if c.OAuthIssuerURI != "" {
		if _, err := url.ParseRequestURI(c.OAuthIssuerURI); err != nil {
			return fmt.Errorf("OAUTH_ISSUER_URI is not a valid URL: %w", err)
		}
	}

	if c.OAuthCallbackPath == "" || !strings.HasPrefix(c.OAuthCallbackPath, "/") {
		return errors.New("OAUTH_CALLBACK_PATH must start with '/'")
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
