package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"golang.org/x/oauth2"
)

// cryptoRandRead is a variable pointing to io.ReadFull(rand.Reader, ...) for testability.
var cryptoRandRead = func(b []byte) (int, error) {
	return io.ReadFull(rand.Reader, b)
}

// PKCEFlowConfig holds settings for the public client PKCE flow.
type PKCEFlowConfig struct {
	IssuerURI string
	ClientID  string
	Scopes    []string
}

// PKCEFlowResult contains the tokens received from the OAuth flow.
type PKCEFlowResult struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	Expiry       time.Time `json:"expiry,omitempty"`
}

// RunPKCEFlow executes a browser-based Authorization Code + PKCE flow.
// It starts an ephemeral localhost server, opens the browser, waits for the callback,
// exchanges the code for tokens, and returns the result.
func RunPKCEFlow(ctx context.Context, cfg PKCEFlowConfig) (*PKCEFlowResult, error) {
	// Find a random available port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("failed to start callback listener: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	oauthCfg := &oauth2.Config{
		ClientID:    cfg.ClientID,
		Scopes:      cfg.Scopes,
		RedirectURL: redirectURI,
		Endpoint: oauth2.Endpoint{
			AuthURL:  cfg.IssuerURI + "/authorize",
			TokenURL: cfg.IssuerURI + "/token",
		},
	}

	// Generate PKCE verifier and state
	verifier := oauth2.GenerateVerifier()
	state, err := generateRandomString(32)
	if err != nil {
		listener.Close()
		return nil, fmt.Errorf("failed to generate state: %w", err)
	}

	// Build auth URL
	authURL := oauthCfg.AuthCodeURL(
		state,
		oauth2.S256ChallengeOption(verifier),
	)

	// Channel to receive the authorization code
	codeCh := make(chan callbackResult, 1)

	// Start callback server
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		receivedState := r.URL.Query().Get("state")
		if receivedState != state {
			codeCh <- callbackResult{err: fmt.Errorf("state mismatch")}
			http.Error(w, "State mismatch — possible CSRF attack", http.StatusBadRequest)
			return
		}

		if errCode := r.URL.Query().Get("error"); errCode != "" {
			errDesc := r.URL.Query().Get("error_description")
			codeCh <- callbackResult{err: fmt.Errorf("authorization error: %s (%s)", errCode, errDesc)}
			fmt.Fprintf(w, "<html><body><h1>Authorization Failed</h1><p>%s: %s</p><p>You can close this tab.</p></body></html>", errCode, errDesc)
			return
		}

		code := r.URL.Query().Get("code")
		if code == "" {
			codeCh <- callbackResult{err: fmt.Errorf("missing authorization code")}
			http.Error(w, "Missing code parameter", http.StatusBadRequest)
			return
		}

		codeCh <- callbackResult{code: code}
		fmt.Fprint(w, `<html><body><h1>✅ Authorization Successful!</h1><p>You can close this tab and return to the terminal.</p><script>window.close()</script></body></html>`)
	})

	srv := &http.Server{Handler: mux}
	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			slog.Error("Callback server error", "error", err)
		}
	}()

	// Open browser
	slog.Info("Opening browser for authentication", "url", authURL)
	if err := openBrowser(authURL); err != nil {
		slog.Warn("Failed to open browser automatically", "error", err)
		fmt.Printf("\nPlease open the following URL in your browser:\n\n  %s\n\n", authURL)
	}

	// Wait for callback or context cancellation
	var result callbackResult
	select {
	case result = <-codeCh:
	case <-ctx.Done():
		srv.Shutdown(context.Background())
		return nil, ctx.Err()
	}

	// Shutdown callback server
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)

	if result.err != nil {
		return nil, result.err
	}

	// Exchange code for tokens with PKCE verifier
	token, err := oauthCfg.Exchange(ctx, result.code, oauth2.VerifierOption(verifier))
	if err != nil {
		return nil, fmt.Errorf("token exchange failed: %w", err)
	}

	return &PKCEFlowResult{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenType:    token.TokenType,
		Expiry:       token.Expiry,
	}, nil
}

// RefreshToken exchanges a refresh token for new access and refresh tokens.
func RefreshToken(ctx context.Context, cfg PKCEFlowConfig, refreshToken string) (*PKCEFlowResult, error) {
	oauthCfg := &oauth2.Config{
		ClientID: cfg.ClientID,
		Scopes:   cfg.Scopes,
		Endpoint: oauth2.Endpoint{
			AuthURL:  cfg.IssuerURI + "/authorize",
			TokenURL: cfg.IssuerURI + "/token",
		},
	}

	tokenSource := oauthCfg.TokenSource(ctx, &oauth2.Token{
		RefreshToken: refreshToken,
	})

	tok, err := tokenSource.Token()
	if err != nil {
		return nil, fmt.Errorf("token refresh failed: %w", err)
	}

	return &PKCEFlowResult{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		TokenType:    tok.TokenType,
		Expiry:       tok.Expiry,
	}, nil
}

type callbackResult struct {
	code string
	err  error
}

// openBrowser opens the given URL in the default system browser.
func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
	return cmd.Start()
}

// generateRandomString creates a URL-safe random string of the given byte length.
func generateRandomString(n int) (string, error) {
	randomBytes := make([]byte, n)
	if _, err := cryptoRandRead(randomBytes); err != nil {
		return "", err
	}
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	result := make([]byte, n)
	for i, b := range randomBytes {
		result[i] = chars[int(b)%len(chars)]
	}
	return string(result), nil
}
