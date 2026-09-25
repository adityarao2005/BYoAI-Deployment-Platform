package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// TokenStore manages token persistence at ~/.byoai/tokens.json.
type TokenStore struct {
	Path string
}

// StoredTokens represents the tokens stored on disk.
type StoredTokens struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	Expiry       time.Time `json:"expiry,omitempty"`
}

// NewTokenStore creates a token store that reads/writes to the given path.
// If path is empty, defaults to ~/.byoai/tokens.json.
func NewTokenStore(path string) (*TokenStore, error) {
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("cannot determine home directory: %w", err)
		}
		path = filepath.Join(home, ".byoai", "tokens.json")
	}
	return &TokenStore{Path: path}, nil
}

// Load reads stored tokens from disk.
func (s *TokenStore) Load() (*StoredTokens, error) {
	data, err := os.ReadFile(s.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil // no tokens stored yet
		}
		return nil, fmt.Errorf("failed to read token file: %w", err)
	}

	var tokens StoredTokens
	if err := json.Unmarshal(data, &tokens); err != nil {
		return nil, fmt.Errorf("failed to parse token file: %w", err)
	}

	return &tokens, nil
}

// Save writes tokens to disk, creating parent directories as needed.
func (s *TokenStore) Save(tokens *StoredTokens) error {
	if tokens == nil {
		return errors.New("cannot save nil tokens")
	}

	dir := filepath.Dir(s.Path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create token directory: %w", err)
	}

	data, err := json.MarshalIndent(tokens, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize tokens: %w", err)
	}

	if err := os.WriteFile(s.Path, data, 0600); err != nil {
		return fmt.Errorf("failed to write token file: %w", err)
	}

	return nil
}

// Clear removes the token file from disk.
func (s *TokenStore) Clear() error {
	err := os.Remove(s.Path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// IsExpired checks if the stored tokens have expired.
func (t *StoredTokens) IsExpired() bool {
	if t.Expiry.IsZero() {
		return false // no expiry set
	}
	return time.Now().After(t.Expiry)
}

// SaveFromPKCEResult converts a PKCEFlowResult into StoredTokens and saves to disk.
func (s *TokenStore) SaveFromPKCEResult(result *PKCEFlowResult) error {
	return s.Save(&StoredTokens{
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		TokenType:    result.TokenType,
		Expiry:       result.Expiry,
	})
}
