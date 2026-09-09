package network

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestRuleEngine_IsAllowed(t *testing.T) {
	tests := []struct {
		name         string
		allowedHosts []string
		deniedHosts  []string
		targetHost   string
		expected     bool
	}{
		{
			name:         "Default allow all when allowedHosts is empty",
			allowedHosts: nil,
			deniedHosts:  nil,
			targetHost:   "example.com",
			expected:     true,
		},
		{
			name:         "Explicit wildcard allow all",
			allowedHosts: []string{"*"},
			deniedHosts:  nil,
			targetHost:   "github.com:443",
			expected:     true,
		},
		{
			name:         "Exact domain allowed",
			allowedHosts: []string{"api.openai.com"},
			deniedHosts:  nil,
			targetHost:   "api.openai.com",
			expected:     true,
		},
		{
			name:         "Exact domain not in allowed list",
			allowedHosts: []string{"api.openai.com"},
			deniedHosts:  nil,
			targetHost:   "example.com",
			expected:     false,
		},
		{
			name:         "Domain wildcard match",
			allowedHosts: []string{"*.github.com"},
			deniedHosts:  nil,
			targetHost:   "raw.github.com:443",
			expected:     true,
		},
		{
			name:         "Domain wildcard root match",
			allowedHosts: []string{"*.github.com"},
			deniedHosts:  nil,
			targetHost:   "github.com",
			expected:     true,
		},
		{
			name:         "Denied takes priority over allowed",
			allowedHosts: []string{"*.google.com"},
			deniedHosts:  []string{"analytics.google.com"},
			targetHost:   "analytics.google.com:443",
			expected:     false,
		},
		{
			name:         "Allowed google subdomains when specific denied",
			allowedHosts: []string{"*.google.com"},
			deniedHosts:  []string{"analytics.google.com"},
			targetHost:   "mail.google.com",
			expected:     true,
		},
		{
			name:         "Direct IP match allowed",
			allowedHosts: []string{"1.1.1.1"},
			deniedHosts:  nil,
			targetHost:   "1.1.1.1:80",
			expected:     true,
		},
		{
			name:         "CIDR block denied",
			allowedHosts: []string{"*"},
			deniedHosts:  []string{"169.254.169.254/32", "10.0.0.0/8"},
			targetHost:   "169.254.169.254:80",
			expected:     false,
		},
		{
			name:         "CIDR block denied subnet target",
			allowedHosts: []string{"*"},
			deniedHosts:  []string{"10.0.0.0/8"},
			targetHost:   "10.1.2.3:443",
			expected:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			re := NewRuleEngine(tt.allowedHosts, tt.deniedHosts)
			got := re.IsAllowed(tt.targetHost)
			if got != tt.expected {
				t.Errorf("IsAllowed(%q) = %v, expected %v", tt.targetHost, got, tt.expected)
			}
		})
	}
}

func TestEgressProxy_HTTP(t *testing.T) {
	// Start a backend test server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatalf("failed to parse backend URL: %v", err)
	}

	// Case 1: Target host allowed
	engineAllowed := NewRuleEngine([]string{backendURL.Host}, nil)
	proxyAllowed, err := NewEgressProxy("127.0.0.1:0", engineAllowed)
	if err != nil {
		t.Fatalf("failed to start egress proxy: %v", err)
	}
	defer proxyAllowed.Close()

	proxyURL, _ := url.Parse("http://" + proxyAllowed.Addr())
	clientAllowed := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
	}

	resp, err := clientAllowed.Get(backend.URL)
	if err != nil {
		t.Fatalf("expected proxy request to succeed, got: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "backend response" {
		t.Errorf("expected 'backend response', got %q", string(body))
	}

	// Case 2: Target host denied
	engineDenied := NewRuleEngine(nil, []string{backendURL.Host})
	proxyDenied, err := NewEgressProxy("127.0.0.1:0", engineDenied)
	if err != nil {
		t.Fatalf("failed to start egress proxy: %v", err)
	}
	defer proxyDenied.Close()

	proxyDeniedURL, _ := url.Parse("http://" + proxyDenied.Addr())
	clientDenied := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyDeniedURL),
		},
	}

	respDenied, err := clientDenied.Get(backend.URL)
	if err != nil {
		// Connection error or 403 response
		return
	}
	defer respDenied.Body.Close()

	if respDenied.StatusCode != http.StatusForbidden {
		t.Errorf("expected status 403 Forbidden for blocked request, got %d", respDenied.StatusCode)
	}
}

func TestEgressProxy_CONNECT(t *testing.T) {
	// Start a backend test server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("connect backend response"))
	}))
	defer backend.Close()

	backendURL, _ := url.Parse(backend.URL)

	// 1. Allowed CONNECT request test
	engineAllowed := NewRuleEngine([]string{backendURL.Host}, nil)
	proxyAllowed, err := NewEgressProxy("127.0.0.1:0", engineAllowed)
	if err != nil {
		t.Fatalf("failed to start egress proxy: %v", err)
	}
	defer proxyAllowed.Close()

	connAllowed, err := net.Dial("tcp", proxyAllowed.Addr())
	if err != nil {
		t.Fatalf("failed to connect to proxy: %v", err)
	}
	defer connAllowed.Close()

	fmt.Fprintf(connAllowed, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", backendURL.Host, backendURL.Host)
	readerAllowed := bufio.NewReader(connAllowed)
	respLine, err := readerAllowed.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read CONNECT response from proxy: %v", err)
	}
	if !strings.Contains(respLine, "200 Connection Established") {
		t.Errorf("expected 200 Connection Established, got %q", respLine)
	}

	// 2. Blocked CONNECT request test
	engineDenied := NewRuleEngine(nil, []string{backendURL.Host})
	proxyDenied, err := NewEgressProxy("127.0.0.1:0", engineDenied)
	if err != nil {
		t.Fatalf("failed to start egress proxy: %v", err)
	}
	defer proxyDenied.Close()

	connDenied, err := net.Dial("tcp", proxyDenied.Addr())
	if err != nil {
		t.Fatalf("failed to connect to proxy: %v", err)
	}
	defer connDenied.Close()

	fmt.Fprintf(connDenied, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", backendURL.Host, backendURL.Host)
	readerDenied := bufio.NewReader(connDenied)
	respLineDenied, err := readerDenied.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read CONNECT response from denied proxy: %v", err)
	}
	if !strings.Contains(respLineDenied, "403") {
		t.Errorf("expected 403 Forbidden for denied CONNECT, got %q", respLineDenied)
	}

	// 3. Real internet domain blocked CONNECT request test (e.g. google.com:443)
	t.Run("Blocked Public Domain google.com", func(t *testing.T) {
		engine := NewRuleEngine([]string{"httpbin.org"}, []string{"google.com", "*.google.com"})
		proxy, err := NewEgressProxy("127.0.0.1:0", engine)
		if err != nil {
			t.Fatalf("failed to start egress proxy: %v", err)
		}
		defer proxy.Close()

		conn, err := net.Dial("tcp", proxy.Addr())
		if err != nil {
			t.Fatalf("failed to connect to proxy: %v", err)
		}
		defer conn.Close()

		target := "google.com:443"
		fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", target, target)
		reader := bufio.NewReader(conn)
		respLine, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("failed to read CONNECT response from proxy: %v", err)
		}
		if !strings.Contains(respLine, "403") {
			t.Errorf("expected 403 Forbidden for blocked google.com CONNECT request, got %q", respLine)
		}
	})
}
