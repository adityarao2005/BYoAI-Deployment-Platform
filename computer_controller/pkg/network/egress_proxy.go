package network

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// RuleEngine evaluates destination hostnames and IP addresses against allowed and denied rules.
type RuleEngine struct {
	allowedHosts []string
	deniedHosts  []string
	allowAll     bool
}

// NewRuleEngine initializes a RuleEngine with normalized rules.
func NewRuleEngine(allowedHosts, deniedHosts []string) *RuleEngine {
	allowAll := false
	if len(allowedHosts) == 0 {
		allowAll = true
	} else {
		for _, h := range allowedHosts {
			if h == "*" || h == "0.0.0.0/0" {
				allowAll = true
				break
			}
		}
	}

	return &RuleEngine{
		allowedHosts: allowedHosts,
		deniedHosts:  deniedHosts,
		allowAll:     allowAll,
	}
}

// IsAllowed evaluates whether target host or IP is allowed by network rules.
// Host can be a hostname (e.g. "github.com"), an IP ("1.1.1.1"), or include a port ("github.com:443").
func (re *RuleEngine) IsAllowed(host string) bool {
	// Strip port if present
	hostName := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostName = h
	}

	hostName = strings.ToLower(strings.TrimSpace(hostName))
	if hostName == "" {
		return false
	}

	// 1. Check denied rules first (deny takes precedence over allow)
	for _, rule := range re.deniedHosts {
		if matchRule(hostName, rule) {
			return false
		}
	}

	// 2. If wildcard allow all, return true
	if re.allowAll {
		return true
	}

	// 3. Check allowed rules
	for _, rule := range re.allowedHosts {
		if matchRule(hostName, rule) {
			return true
		}
	}

	// Default to deny if explicit allowedHosts list is defined and host does not match
	return false
}

// matchRule checks if a host/IP matches a pattern (wildcard, domain prefix, exact, or CIDR block).
func matchRule(target, pattern string) bool {
	pattern = strings.ToLower(strings.TrimSpace(pattern))
	if pattern == "" {
		return false
	}
	if pattern == "*" || pattern == "0.0.0.0/0" {
		return true
	}

	patternHost := pattern
	if pHost, _, err := net.SplitHostPort(pattern); err == nil {
		patternHost = pHost
	}

	// Check CIDR pattern if target is an IP
	if targetIP, err := netip.ParseAddr(target); err == nil {
		if prefix, err := netip.ParsePrefix(patternHost); err == nil {
			return prefix.Contains(targetIP)
		}
		if patternIP, err := netip.ParseAddr(patternHost); err == nil {
			return targetIP == patternIP
		}
	}

	// Check domain match
	if target == patternHost {
		return true
	}

	// Domain wildcard matching (e.g. "*.example.com" matches "foo.example.com" and "example.com")
	if strings.HasPrefix(patternHost, "*.") {
		domainSuffix := strings.TrimPrefix(patternHost, "*.")
		if target == domainSuffix || strings.HasSuffix(target, "."+domainSuffix) {
			return true
		}
	}

	return false
}

// EgressProxy is an in-process HTTP and HTTPS CONNECT proxy server enforcing RuleEngine rules.
type EgressProxy struct {
	listener net.Listener
	server   *http.Server
	engine   *RuleEngine
	mu       sync.Mutex
	closed   bool
}

// NewEgressProxy creates and starts an EgressProxy listening on the specified address (e.g., "0.0.0.0:0").
func NewEgressProxy(listenAddr string, engine *RuleEngine) (*EgressProxy, error) {
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on %s: %w", listenAddr, err)
	}

	proxy := &EgressProxy{
		listener: listener,
		engine:   engine,
	}

	server := &http.Server{
		Handler:           proxy,
		ReadHeaderTimeout: 10 * time.Second,
	}
	proxy.server = server

	go func() {
		_ = server.Serve(listener)
	}()

	return proxy, nil
}

// Addr returns the network address the proxy is listening on.
func (p *EgressProxy) Addr() string {
	if p.listener == nil {
		return ""
	}
	return p.listener.Addr().String()
}

// Close gracefully stops the proxy server and listener.
func (p *EgressProxy) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return p.server.Shutdown(ctx)
}

// ServeHTTP handles incoming proxy requests (HTTP GET/POST/etc and HTTPS CONNECT tunnels).
func (p *EgressProxy) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	if req.Method == http.MethodConnect {
		p.handleConnect(rw, req)
		return
	}

	p.handleHTTP(rw, req)
}

func (p *EgressProxy) handleConnect(rw http.ResponseWriter, req *http.Request) {
	targetHost := req.Host
	if targetHost == "" {
		targetHost = req.URL.Host
	}

	if !p.engine.IsAllowed(targetHost) {
		http.Error(rw, "Connection blocked by network rules", http.StatusForbidden)
		return
	}

	hijacker, ok := rw.(http.Hijacker)
	if !ok {
		http.Error(rw, "Hijacking not supported", http.StatusInternalServerError)
		return
	}

	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		http.Error(rw, err.Error(), http.StatusServiceUnavailable)
		return
	}

	// Connect to target host
	targetConn, err := net.DialTimeout("tcp", targetHost, 10*time.Second)
	if err != nil {
		clientConn.Write([]byte("HTTP/1.1 502 Bad Gateway\r\n\r\n"))
		clientConn.Close()
		return
	}

	// Inform client that connection is established
	clientConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	// Pipe data bi-directionally
	go func() {
		defer clientConn.Close()
		defer targetConn.Close()
		_, _ = io.Copy(targetConn, clientConn)
	}()

	go func() {
		defer clientConn.Close()
		defer targetConn.Close()
		_, _ = io.Copy(clientConn, targetConn)
	}()
}

func (p *EgressProxy) handleHTTP(rw http.ResponseWriter, req *http.Request) {
	targetHost := req.Host
	if targetHost == "" {
		targetHost = req.URL.Host
	}

	if !p.engine.IsAllowed(targetHost) {
		http.Error(rw, "Request blocked by network rules", http.StatusForbidden)
		return
	}

	if !req.URL.IsAbs() {
		http.Error(rw, "Request URI must be absolute for proxy", http.StatusBadRequest)
		return
	}

	// Remove hop-by-hop headers
	outReq := req.Clone(req.Context())
	outReq.RequestURI = ""

	transport := &http.Transport{
		Proxy:                 nil,
		ResponseHeaderTimeout: 15 * time.Second,
	}

	resp, err := transport.RoundTrip(outReq)
	if err != nil {
		http.Error(rw, fmt.Sprintf("Proxy error: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for k, vv := range resp.Header {
		for _, v := range vv {
			rw.Header().Add(k, v)
		}
	}

	rw.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(rw, resp.Body)
}

