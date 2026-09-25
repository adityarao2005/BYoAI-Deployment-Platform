package config

import (
	"os"
	"testing"
)

func TestChatUIConfigDefaults(t *testing.T) {
	os.Unsetenv("AGENT_HARNESS_URI")
	os.Unsetenv("OAUTH_ISSUER_URI")
	os.Unsetenv("LISTEN_ADDR")
	os.Unsetenv("OAUTH_CALLBACK_PATH")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if cfg.AgentHarnessURI != "http://localhost:3000" {
		t.Errorf("expected AgentHarnessURI 'http://localhost:3000', got '%s'", cfg.AgentHarnessURI)
	}
	if cfg.OAuthCallbackPath != "/auth/callback" {
		t.Errorf("expected OAuthCallbackPath '/auth/callback', got '%s'", cfg.OAuthCallbackPath)
	}
	if cfg.ListenAddr != ":8081" {
		t.Errorf("expected ListenAddr ':8081', got '%s'", cfg.ListenAddr)
	}
}

func TestChatUIConfigCustom(t *testing.T) {
	t.Setenv("AGENT_HARNESS_URI", "http://harness:3000")
	t.Setenv("OAUTH_ISSUER_URI", "https://auth.company.com")
	t.Setenv("OAUTH_CLIENT_ID", "custom-client")
	t.Setenv("OAUTH_CLIENT_SECRET", "custom-secret")
	t.Setenv("OAUTH_CALLBACK_PATH", "/custom/callback")
	t.Setenv("LISTEN_ADDR", ":8888")
	t.Setenv("LOG_LEVEL", "DEBUG")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.OAuthClientID != "custom-client" {
		t.Errorf("unexpected OAuthClientID: %s", cfg.OAuthClientID)
	}
	if cfg.OAuthCallbackPath != "/custom/callback" {
		t.Errorf("unexpected OAuthCallbackPath: %s", cfg.OAuthCallbackPath)
	}
	if cfg.ListenAddr != ":8888" {
		t.Errorf("unexpected ListenAddr: %s", cfg.ListenAddr)
	}
}

func TestChatUIConfigInvalidCallback(t *testing.T) {
	t.Setenv("OAUTH_CALLBACK_PATH", "no-leading-slash")
	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected error for callback without leading slash, got nil")
	}
}
