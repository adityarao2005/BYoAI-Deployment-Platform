package computer

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ReaperProvider wraps any IComputerProvider to provide:
// 1. Inactivity (idle) container/pod reaping after a configurable duration.
// 2. A graceful shutdown hook to clean up all active computers/containers when the server stops.
type ReaperProvider struct {
	provider     IComputerProvider
	idleTimeout  time.Duration
	reapInterval time.Duration

	mu       sync.RWMutex
	sessions map[string]time.Time

	stopOnce sync.Once
	stopCh   chan struct{}
	doneCh   chan struct{}
}

// NewReaperProvider initializes a new ReaperProvider wrapping the given provider.
func NewReaperProvider(provider IComputerProvider, idleTimeout time.Duration) *ReaperProvider {
	interval := idleTimeout / 2
	if interval <= 0 || interval > 10*time.Second {
		interval = 10 * time.Second
	}
	return &ReaperProvider{
		provider:     provider,
		idleTimeout:  idleTimeout,
		reapInterval: interval,
		sessions:     make(map[string]time.Time),
		stopCh:       make(chan struct{}),
		doneCh:       make(chan struct{}),
	}
}

// Start begins the background idle reaping loop in a goroutine.
func (r *ReaperProvider) Start(ctx context.Context) {
	go func() {
		defer close(r.doneCh)

		if r.idleTimeout <= 0 {
			<-r.stopCh
			return
		}

		ticker := time.NewTicker(r.reapInterval)
		defer ticker.Stop()

		for {
			select {
			case <-r.stopCh:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.reapExpiredSessions(ctx)
			}
		}
	}()
}

func (r *ReaperProvider) reapExpiredSessions(ctx context.Context) {
	r.mu.RLock()
	now := time.Now()
	var expired []string
	for sessionID, lastActivity := range r.sessions {
		if now.Sub(lastActivity) >= r.idleTimeout {
			expired = append(expired, sessionID)
		}
	}
	r.mu.RUnlock()

	for _, sessionID := range expired {
		fmt.Printf("reaper: reaping idle computer session %s (idle for %v)\n", sessionID, r.idleTimeout)
		_ = r.DeleteComputer(ctx, sessionID)
	}
}

// Touch updates the last activity timestamp for a given session.
func (r *ReaperProvider) Touch(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.sessions[sessionID]; exists {
		r.sessions[sessionID] = time.Now()
	}
}

// GetSessionActivity returns the last activity timestamp for a session (if tracked).
func (r *ReaperProvider) GetSessionActivity(sessionID string) (time.Time, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, exists := r.sessions[sessionID]
	return t, exists
}

// CreateComputer creates a new computer session and tracks its activity time.
func (r *ReaperProvider) CreateComputer(ctx context.Context, config ComputerConfig) (string, error) {
	sessionID, err := r.provider.CreateComputer(ctx, config)
	if err != nil {
		return "", err
	}

	r.mu.Lock()
	r.sessions[sessionID] = time.Now()
	r.mu.Unlock()

	return sessionID, nil
}

// GetComputer retrieves a computer and touches its activity timestamp.
func (r *ReaperProvider) GetComputer(ctx context.Context, sessionID string) (IComputer, error) {
	r.Touch(sessionID)
	return r.provider.GetComputer(ctx, sessionID)
}

// DeleteComputer removes the computer session and untracks it.
func (r *ReaperProvider) DeleteComputer(ctx context.Context, sessionID string) error {
	r.mu.Lock()
	delete(r.sessions, sessionID)
	r.mu.Unlock()

	return r.provider.DeleteComputer(ctx, sessionID)
}

// Stop acts as the graceful shutdown hook: stops background reaping and kills all active computers.
func (r *ReaperProvider) Stop(ctx context.Context) error {
	r.stopOnce.Do(func() {
		close(r.stopCh)
	})
	<-r.doneCh

	r.mu.Lock()
	var activeSessions []string
	for sessionID := range r.sessions {
		activeSessions = append(activeSessions, sessionID)
	}
	r.sessions = make(map[string]time.Time)
	r.mu.Unlock()

	var firstErr error
	for _, sessionID := range activeSessions {
		fmt.Printf("reaper shutdown hook: cleaning up computer session %s\n", sessionID)
		if err := r.provider.DeleteComputer(ctx, sessionID); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}
