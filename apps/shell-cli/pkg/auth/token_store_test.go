package auth

import (
	"path/filepath"
	"testing"
	"time"
)

func TestTokenStore_SaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	store := &TokenStore{Path: path}

	tokens := &StoredTokens{
		AccessToken:  "test-access-token",
		RefreshToken: "test-refresh-token",
		TokenType:    "Bearer",
		Expiry:       time.Now().Add(time.Hour).Truncate(time.Second),
	}

	if err := store.Save(tokens); err != nil {
		t.Fatalf("failed to save tokens: %v", err)
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("failed to load tokens: %v", err)
	}

	if loaded.AccessToken != tokens.AccessToken {
		t.Errorf("expected access_token '%s', got '%s'", tokens.AccessToken, loaded.AccessToken)
	}
	if loaded.RefreshToken != tokens.RefreshToken {
		t.Errorf("expected refresh_token '%s', got '%s'", tokens.RefreshToken, loaded.RefreshToken)
	}
	if loaded.TokenType != tokens.TokenType {
		t.Errorf("expected token_type '%s', got '%s'", tokens.TokenType, loaded.TokenType)
	}
}

func TestTokenStore_LoadNonExistent(t *testing.T) {
	store := &TokenStore{Path: filepath.Join(t.TempDir(), "nonexistent.json")}

	tokens, err := store.Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tokens != nil {
		t.Error("expected nil tokens for non-existent file")
	}
}

func TestTokenStore_Clear(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	store := &TokenStore{Path: path}

	// Save and then clear
	if err := store.Save(&StoredTokens{AccessToken: "abc"}); err != nil {
		t.Fatalf("failed to save: %v", err)
	}

	if err := store.Clear(); err != nil {
		t.Fatalf("failed to clear: %v", err)
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("unexpected error after clear: %v", err)
	}
	if loaded != nil {
		t.Error("expected nil tokens after clear")
	}
}

func TestTokenStore_ClearNonExistent(t *testing.T) {
	store := &TokenStore{Path: filepath.Join(t.TempDir(), "nonexistent.json")}

	if err := store.Clear(); err != nil {
		t.Errorf("unexpected error clearing non-existent file: %v", err)
	}
}

func TestStoredTokens_IsExpired(t *testing.T) {
	notExpired := &StoredTokens{
		Expiry: time.Now().Add(time.Hour),
	}
	if notExpired.IsExpired() {
		t.Error("expected token to not be expired")
	}

	expired := &StoredTokens{
		Expiry: time.Now().Add(-time.Hour),
	}
	if !expired.IsExpired() {
		t.Error("expected token to be expired")
	}

	noExpiry := &StoredTokens{}
	if noExpiry.IsExpired() {
		t.Error("expected no-expiry token to not be considered expired")
	}
}

func TestTokenStore_SaveFromPKCEResult(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")
	store := &TokenStore{Path: path}

	result := &PKCEFlowResult{
		AccessToken:  "pkce-access",
		RefreshToken: "pkce-refresh",
		TokenType:    "Bearer",
		Expiry:       time.Now().Add(time.Hour).Truncate(time.Second),
	}

	if err := store.SaveFromPKCEResult(result); err != nil {
		t.Fatalf("failed to save from PKCE result: %v", err)
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("failed to load: %v", err)
	}

	if loaded.AccessToken != "pkce-access" {
		t.Errorf("unexpected access_token: %s", loaded.AccessToken)
	}
}
