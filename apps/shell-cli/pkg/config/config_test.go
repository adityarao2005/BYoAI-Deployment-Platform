package config

import (
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.AgentHarnessURI != "http://localhost:3000" {
		t.Errorf("expected default AgentHarnessURI 'http://localhost:3000', got '%s'", cfg.AgentHarnessURI)
	}
	if cfg.DefaultMode != "interactive" {
		t.Errorf("expected default mode 'interactive', got '%s'", cfg.DefaultMode)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected default config to be valid, got error: %v", err)
	}
}

func TestSaveAndLoadConfig(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "sub", "config.yaml")

	if ConfigExists(configPath) {
		t.Fatal("expected config to not exist yet")
	}

	cfg := &Config{
		AgentHarnessURI: "http://custom-harness:4000",
		OAuthIssuerURI:  "https://custom-auth.example.com",
		OAuthClientID:   "custom-client-id",
		OAuthScopes:     []string{"openid", "agent:read"},
		DefaultMode:     "non-interactive",
		Theme:           "custom-dark",
	}

	if err := SaveConfig(configPath, cfg); err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	if !ConfigExists(configPath) {
		t.Fatal("expected config to exist after saving")
	}

	loaded, err := LoadConfig(configPath)
	if err != nil {
		t.Fatalf("failed to load saved config: %v", err)
	}

	if loaded.AgentHarnessURI != cfg.AgentHarnessURI {
		t.Errorf("expected %s, got %s", cfg.AgentHarnessURI, loaded.AgentHarnessURI)
	}
	if loaded.DefaultMode != "non-interactive" {
		t.Errorf("expected %s, got %s", cfg.DefaultMode, loaded.DefaultMode)
	}
}

func TestInvalidConfigValidation(t *testing.T) {
	cfg := &Config{
		AgentHarnessURI: "",
		OAuthIssuerURI:  "https://auth.example.com",
		OAuthClientID:   "client",
		DefaultMode:     "invalid-mode",
	}

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected validation error, got nil")
	}
}
