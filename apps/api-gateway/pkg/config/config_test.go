package config

import (
	"os"
	"testing"
)

func TestConfigLoadFromEnvDefaults(t *testing.T) {
	// Clear env
	os.Unsetenv("AGENT_HARNESS_URI")
	os.Unsetenv("JWKS_URI")
	os.Unsetenv("LISTEN_ADDR")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("expected no error with defaults, got: %v", err)
	}

	if cfg.AgentHarnessURI != "http://localhost:3000" {
		t.Errorf("expected AgentHarnessURI 'http://localhost:3000', got '%s'", cfg.AgentHarnessURI)
	}
	if cfg.ListenAddr != ":8080" {
		t.Errorf("expected ListenAddr ':8080', got '%s'", cfg.ListenAddr)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected LogLevel 'info', got '%s'", cfg.LogLevel)
	}
}

func TestConfigCustomEnv(t *testing.T) {
	t.Setenv("AGENT_HARNESS_URI", "http://harness.internal:4000")
	t.Setenv("JWKS_URI", "https://auth.example.com/.well-known/jwks.json")
	t.Setenv("LISTEN_ADDR", ":9090")
	t.Setenv("JWT_ISSUER", "https://auth.example.com")
	t.Setenv("JWT_AUDIENCE", "byoai-api")
	t.Setenv("LOG_LEVEL", "DEBUG")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.AgentHarnessURI != "http://harness.internal:4000" {
		t.Errorf("unexpected AgentHarnessURI: %s", cfg.AgentHarnessURI)
	}
	if cfg.JWKSURI != "https://auth.example.com/.well-known/jwks.json" {
		t.Errorf("unexpected JWKSURI: %s", cfg.JWKSURI)
	}
	if cfg.ListenAddr != ":9090" {
		t.Errorf("unexpected ListenAddr: %s", cfg.ListenAddr)
	}
	if cfg.JWTIssuer != "https://auth.example.com" {
		t.Errorf("unexpected JWTIssuer: %s", cfg.JWTIssuer)
	}
	if cfg.JWTAudience != "byoai-api" {
		t.Errorf("unexpected JWTAudience: %s", cfg.JWTAudience)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("unexpected LogLevel: %s", cfg.LogLevel)
	}
}

func TestConfigInvalidURL(t *testing.T) {
	t.Setenv("AGENT_HARNESS_URI", "::not-a-url")
	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error for invalid AGENT_HARNESS_URI, got nil")
	}
}
