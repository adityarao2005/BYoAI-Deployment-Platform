package computer

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

type MockProvider struct {
	mu        sync.Mutex
	computers map[string]IComputer
	deleted   map[string]bool
	counter   int
}

func NewMockProvider() *MockProvider {
	return &MockProvider{
		computers: make(map[string]IComputer),
		deleted:   make(map[string]bool),
	}
}

func (m *MockProvider) CreateComputer(ctx context.Context, config ComputerConfig) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counter++
	sessionID := fmt.Sprintf("session-%d", m.counter)
	m.computers[sessionID] = LocalComputer{sessionId: sessionID}
	return sessionID, nil
}

func (m *MockProvider) GetComputer(ctx context.Context, sessionID string) (IComputer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	comp, exists := m.computers[sessionID]
	if !exists {
		return nil, fmt.Errorf("computer not found for sessionId %s", sessionID)
	}
	return comp, nil
}

func (m *MockProvider) DeleteComputer(ctx context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.computers[sessionID]; exists {
		delete(m.computers, sessionID)
		m.deleted[sessionID] = true
	}
	return nil
}

func (m *MockProvider) IsDeleted(sessionID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.deleted[sessionID]
}

func TestReaperProvider_TrackingAndTouch(t *testing.T) {
	mock := NewMockProvider()
	reaper := NewReaperProvider(mock, 1*time.Minute)

	ctx := context.Background()
	sessionID, err := reaper.CreateComputer(ctx, ComputerConfig{Image: "test"})
	if err != nil {
		t.Fatalf("unexpected error creating computer: %v", err)
	}

	t1, exists := reaper.GetSessionActivity(sessionID)
	if !exists {
		t.Fatalf("expected session %s to be tracked", sessionID)
	}

	time.Sleep(10 * time.Millisecond)

	comp, err := reaper.GetComputer(ctx, sessionID)
	if err != nil {
		t.Fatalf("unexpected error getting computer: %v", err)
	}
	if comp == nil {
		t.Fatal("expected non-nil computer")
	}

	t2, _ := reaper.GetSessionActivity(sessionID)
	if !t2.After(t1) {
		t.Errorf("expected lastActivity after GetComputer (%v) to be after initial (%v)", t2, t1)
	}
}

func TestReaperProvider_IdleReaping(t *testing.T) {
	mock := NewMockProvider()
	idleTimeout := 50 * time.Millisecond
	reaper := NewReaperProvider(mock, idleTimeout)
	reaper.reapInterval = 10 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	reaper.Start(ctx)
	defer reaper.Stop(ctx)

	sessionID, err := reaper.CreateComputer(ctx, ComputerConfig{Image: "test"})
	if err != nil {
		t.Fatalf("failed to create computer: %v", err)
	}

	// Wait for reaper to sweep and delete idle computer
	time.Sleep(150 * time.Millisecond)

	if !mock.IsDeleted(sessionID) {
		t.Errorf("expected session %s to be reaped due to inactivity", sessionID)
	}

	_, err = reaper.GetComputer(ctx, sessionID)
	if err == nil {
		t.Errorf("expected error after computer was reaped, got nil")
	}
}

func TestReaperProvider_TouchPreventsReaping(t *testing.T) {
	mock := NewMockProvider()
	idleTimeout := 100 * time.Millisecond
	reaper := NewReaperProvider(mock, idleTimeout)
	reaper.reapInterval = 20 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	reaper.Start(ctx)
	defer reaper.Stop(ctx)

	sessionID, err := reaper.CreateComputer(ctx, ComputerConfig{Image: "test"})
	if err != nil {
		t.Fatalf("failed to create computer: %v", err)
	}

	// Keep touching the computer before it expires
	for i := 0; i < 4; i++ {
		time.Sleep(30 * time.Millisecond)
		_, err := reaper.GetComputer(ctx, sessionID)
		if err != nil {
			t.Fatalf("unexpected error on GetComputer iteration %d: %v", i, err)
		}
	}

	if mock.IsDeleted(sessionID) {
		t.Errorf("session %s was reaped despite active touches", sessionID)
	}
}

func TestReaperProvider_ShutdownHook(t *testing.T) {
	mock := NewMockProvider()
	reaper := NewReaperProvider(mock, 10*time.Minute)

	ctx := context.Background()
	reaper.Start(ctx)

	s1, _ := reaper.CreateComputer(ctx, ComputerConfig{Image: "test"})
	s2, _ := reaper.CreateComputer(ctx, ComputerConfig{Image: "test"})

	err := reaper.Stop(ctx)
	if err != nil {
		t.Fatalf("unexpected error during reaper Stop: %v", err)
	}

	if !mock.IsDeleted(s1) {
		t.Errorf("expected session %s to be deleted on shutdown", s1)
	}
	if !mock.IsDeleted(s2) {
		t.Errorf("expected session %s to be deleted on shutdown", s2)
	}
}
