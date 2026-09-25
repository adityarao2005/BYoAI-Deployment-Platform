package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/auth"
)

// TranscriptItem represents a message or action in an interaction history.
type TranscriptItem struct {
	Role      string         `json:"role,omitempty"`
	Content   string         `json:"content,omitempty"`
	Type      string         `json:"type,omitempty"`
	Name      string         `json:"name,omitempty"`
	Arguments map[string]any `json:"arguments,omitempty"`
	Result    any            `json:"result,omitempty"`
	Timestamp string         `json:"timestamp,omitempty"`
}

// InteractionDetail represents the full interaction returned by GET /interactions/:id.
type InteractionDetail struct {
	ID         string           `json:"id"`
	UserID     string           `json:"userId"`
	Mode       string           `json:"mode"`
	Transcript []TranscriptItem `json:"transcript"`
}

// InteractionSummary represents an item in GET /interactions.
type InteractionSummary struct {
	ID string `json:"id"`
}

// CreateInteractionResponse represents the response from POST /interactions.
type CreateInteractionResponse struct {
	ID string `json:"id"`
}

// SendMessageResponse represents the response from POST /interactions/:id.
type SendMessageResponse struct {
	Success bool `json:"success"`
}

// HarnessClient is the HTTP client for interacting with the agentic-harness API.
type HarnessClient struct {
	baseURL    string
	httpClient *http.Client
	tokenStore *auth.TokenStore
	authCfg    *auth.PKCEFlowConfig
}

// NewHarnessClient creates a new HarnessClient.
func NewHarnessClient(baseURL string, tokenStore *auth.TokenStore, authCfg *auth.PKCEFlowConfig) *HarnessClient {
	return &HarnessClient{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		tokenStore: tokenStore,
		authCfg:    authCfg,
	}
}

// getValidToken retrieves a valid access token, attempting refresh if expired.
func (c *HarnessClient) getValidToken(ctx context.Context) (string, error) {
	if c.tokenStore == nil {
		return "", fmt.Errorf("no token store configured")
	}

	tokens, err := c.tokenStore.Load()
	if err != nil {
		return "", fmt.Errorf("failed to load stored tokens: %w", err)
	}
	if tokens == nil {
		return "", fmt.Errorf("no tokens found; please log in first")
	}

	if tokens.IsExpired() && tokens.RefreshToken != "" && c.authCfg != nil {
		// Attempt refresh
		refreshed, err := auth.RefreshToken(ctx, *c.authCfg, tokens.RefreshToken)
		if err == nil {
			_ = c.tokenStore.SaveFromPKCEResult(refreshed)
			return refreshed.AccessToken, nil
		}
	}

	if tokens.AccessToken == "" {
		return "", fmt.Errorf("no access token available; please run login first")
	}

	return tokens.AccessToken, nil
}

// CreateInteraction creates a new agent interaction session with the given mode ("interactive" or "non-interactive").
func (c *HarnessClient) CreateInteraction(ctx context.Context, mode string) (*CreateInteractionResponse, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	reqBody, _ := json.Marshal(map[string]string{"mode": mode})
	url := fmt.Sprintf("%s/interactions", c.baseURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("create interaction request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("create interaction failed (status %d): %s", resp.StatusCode, string(body))
	}

	var result CreateInteractionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode create interaction response: %w", err)
	}

	return &result, nil
}

// SendMessage sends a user prompt/message to an active interaction.
func (c *HarnessClient) SendMessage(ctx context.Context, interactionID string, message string) error {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return err
	}

	reqBody, _ := json.Marshal(map[string]string{"message": message})
	url := fmt.Sprintf("%s/interactions/%s", c.baseURL, interactionID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send message request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("send message failed (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetInteraction retrieves the full interaction history and metadata.
func (c *HarnessClient) GetInteraction(ctx context.Context, interactionID string) (*InteractionDetail, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/interactions/%s", c.baseURL, interactionID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get interaction request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get interaction failed (status %d): %s", resp.StatusCode, string(body))
	}

	var detail InteractionDetail
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		return nil, fmt.Errorf("failed to decode interaction detail: %w", err)
	}

	return &detail, nil
}

// ListInteractions lists all interaction sessions for the authenticated user.
func (c *HarnessClient) ListInteractions(ctx context.Context) ([]InteractionSummary, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/interactions", c.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list interactions request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list interactions failed (status %d): %s", resp.StatusCode, string(body))
	}

	var list []InteractionSummary
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, fmt.Errorf("failed to decode interaction list: %w", err)
	}

	return list, nil
}
