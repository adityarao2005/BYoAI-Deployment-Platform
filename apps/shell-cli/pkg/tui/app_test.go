package tui

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/auth"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/client"
	tea "github.com/charmbracelet/bubbletea"
)

// ─── Mock SSE Harness Server ─────────────────────────────────────────

// mockHarnessServer creates an httptest.Server that simulates the agentic-harness API.
// It accepts configurable SSE event sequences and delays.
type mockSSEEvent struct {
	Event string
	Data  string
	Delay time.Duration // delay before sending this event
}

func newMockHarnessServer(t *testing.T, sseEvents []mockSSEEvent) *httptest.Server {
	t.Helper()
	interactionCreated := false
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Auth check
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/interactions":
			interactionCreated = true
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "test-interaction"})

		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/interactions/") && !strings.HasSuffix(r.URL.Path, "/sse"):
			if !interactionCreated {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})

		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/sse"):
			if !interactionCreated {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			// SSE stream
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Connection", "keep-alive")
			w.Header().Set("X-Accel-Buffering", "no")

			flusher, ok := w.(http.Flusher)
			if !ok {
				t.Fatal("server does not support flushing")
				return
			}

			// Send connected event
			fmt.Fprintf(w, "event: connected\ndata: {\"agentId\":\"test-interaction\"}\n\n")
			flusher.Flush()

			for _, evt := range sseEvents {
				if evt.Delay > 0 {
					time.Sleep(evt.Delay)
				}
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Event, evt.Data)
				flusher.Flush()
			}

		default:
			http.NotFound(w, r)
		}
	}))
}

func newTestHarnessClient(t *testing.T, serverURL string) *client.HarnessClient {
	t.Helper()
	dir := t.TempDir()
	store := &auth.TokenStore{Path: filepath.Join(dir, "tokens.json")}
	_ = store.Save(&auth.StoredTokens{
		AccessToken: "test-token",
		Expiry:      time.Now().Add(1 * time.Hour),
	})
	return client.NewHarnessClient(serverURL, store, nil)
}

// ─── SSE Integration Tests ──────────────────────────────────────────

func TestSSEStreamEvents_AgentMessageAndComplete(t *testing.T) {
	sseEvents := []mockSSEEvent{
		{Event: "agent:run", Data: `{"agentId":"test-interaction"}`},
		{Event: "agent:message", Data: `{"agentId":"test-interaction","content":"Hello from agent!"}`, Delay: 50 * time.Millisecond},
		{Event: "agent:complete", Data: `{"agentId":"test-interaction"}`, Delay: 50 * time.Millisecond},
	}

	ts := newMockHarnessServer(t, sseEvents)
	defer ts.Close()

	harnessClient := newTestHarnessClient(t, ts.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Create interaction first
	_, err := harnessClient.CreateInteraction(ctx, "interactive")
	if err != nil {
		t.Fatalf("CreateInteraction failed: %v", err)
	}

	// Connect to SSE
	events, errs, err := harnessClient.StreamEvents(ctx, "test-interaction")
	if err != nil {
		t.Fatalf("StreamEvents failed: %v", err)
	}

	var collected []client.SSEEvent
	timeout := time.After(3 * time.Second)

loop:
	for {
		select {
		case evt, ok := <-events:
			if !ok {
				break loop
			}
			collected = append(collected, evt)
			// Stop after agent:complete
			if evt.Event == "agent:complete" {
				break loop
			}
		case err, ok := <-errs:
			if !ok {
				break loop
			}
			t.Fatalf("SSE error: %v", err)
		case <-timeout:
			t.Fatal("Timed out waiting for SSE events")
		}
	}

	cancel()

	// Verify we got: connected, agent:run, agent:message, agent:complete
	if len(collected) < 3 {
		t.Fatalf("Expected at least 3 events (connected, agent:run, agent:message, agent:complete), got %d: %+v", len(collected), collected)
	}

	// Find agent:message
	found := false
	for _, evt := range collected {
		if evt.Event == "agent:message" && strings.Contains(evt.Data, "Hello from agent!") {
			found = true
		}
	}
	if !found {
		t.Error("Expected agent:message event with 'Hello from agent!' content")
	}

	// Find agent:complete
	completeFound := false
	for _, evt := range collected {
		if evt.Event == "agent:complete" {
			completeFound = true
		}
	}
	if !completeFound {
		t.Error("Expected agent:complete event")
	}
}

func TestSSEStreamEvents_ToolCallFlow(t *testing.T) {
	sseEvents := []mockSSEEvent{
		{Event: "agent:run", Data: `{"agentId":"test-interaction"}`},
		{Event: "tool:call", Data: `{"agentId":"test-interaction","toolCallId":"tc1","tool":"calculator","args":{"a":5,"b":7}}`, Delay: 30 * time.Millisecond},
		{Event: "tool:complete", Data: `{"agentId":"test-interaction","toolCallId":"tc1","tool":"calculator","result":{"sum":12}}`, Delay: 30 * time.Millisecond},
		{Event: "agent:run", Data: `{"agentId":"test-interaction"}`},
		{Event: "agent:message", Data: `{"agentId":"test-interaction","content":"The sum is 12."}`, Delay: 30 * time.Millisecond},
		{Event: "agent:complete", Data: `{"agentId":"test-interaction"}`, Delay: 30 * time.Millisecond},
	}

	ts := newMockHarnessServer(t, sseEvents)
	defer ts.Close()

	harnessClient := newTestHarnessClient(t, ts.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := harnessClient.CreateInteraction(ctx, "interactive")
	if err != nil {
		t.Fatalf("CreateInteraction failed: %v", err)
	}

	events, errs, err := harnessClient.StreamEvents(ctx, "test-interaction")
	if err != nil {
		t.Fatalf("StreamEvents failed: %v", err)
	}

	var collected []client.SSEEvent
	timeout := time.After(3 * time.Second)
loop:
	for {
		select {
		case evt, ok := <-events:
			if !ok {
				break loop
			}
			collected = append(collected, evt)
			if evt.Event == "agent:complete" {
				break loop
			}
		case err, ok := <-errs:
			if !ok {
				break loop
			}
			t.Fatalf("SSE error: %v", err)
		case <-timeout:
			t.Fatal("Timed out waiting for SSE events")
		}
	}
	cancel()

	// Verify event ordering: connected → agent:run → tool:call → tool:complete → agent:run → agent:message → agent:complete
	eventNames := make([]string, len(collected))
	for i, evt := range collected {
		eventNames[i] = evt.Event
	}

	expectedSequence := []string{"tool:call", "tool:complete", "agent:message", "agent:complete"}
	seqIdx := 0
	for _, name := range eventNames {
		if seqIdx < len(expectedSequence) && name == expectedSequence[seqIdx] {
			seqIdx++
		}
	}
	if seqIdx != len(expectedSequence) {
		t.Errorf("Expected SSE event sequence %v within %v, matched up to index %d", expectedSequence, eventNames, seqIdx)
	}
}

func TestSSEStreamEvents_ErrorFlow(t *testing.T) {
	sseEvents := []mockSSEEvent{
		{Event: "agent:run", Data: `{"agentId":"test-interaction"}`},
		{Event: "agent:error", Data: `{"agentId":"test-interaction","error":"Model API failure","context":"agent:run"}`, Delay: 50 * time.Millisecond},
		{Event: "agent:complete", Data: `{"agentId":"test-interaction"}`, Delay: 10 * time.Millisecond},
	}

	ts := newMockHarnessServer(t, sseEvents)
	defer ts.Close()

	harnessClient := newTestHarnessClient(t, ts.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := harnessClient.CreateInteraction(ctx, "interactive")
	if err != nil {
		t.Fatalf("CreateInteraction failed: %v", err)
	}

	events, errs, err := harnessClient.StreamEvents(ctx, "test-interaction")
	if err != nil {
		t.Fatalf("StreamEvents failed: %v", err)
	}

	var collected []client.SSEEvent
	timeout := time.After(3 * time.Second)
loop:
	for {
		select {
		case evt, ok := <-events:
			if !ok {
				break loop
			}
			collected = append(collected, evt)
			if evt.Event == "agent:complete" {
				break loop
			}
		case err, ok := <-errs:
			if !ok {
				break loop
			}
			t.Fatalf("SSE error: %v", err)
		case <-timeout:
			t.Fatal("Timed out waiting for SSE events")
		}
	}
	cancel()

	// Verify error event is present
	errorFound := false
	for _, evt := range collected {
		if evt.Event == "agent:error" && strings.Contains(evt.Data, "Model API failure") {
			errorFound = true
		}
	}
	if !errorFound {
		t.Error("Expected agent:error event with 'Model API failure'")
	}

	// Verify complete event follows error
	completeFound := false
	for _, evt := range collected {
		if evt.Event == "agent:complete" {
			completeFound = true
		}
	}
	if !completeFound {
		t.Error("Expected agent:complete event after error")
	}
}

// ─── TUI Model Unit Tests ───────────────────────────────────────────

func TestAppModel_HandleSSEEvent_AgentMessage(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.interactionID = "test-id"

	evt := client.SSEEvent{
		Event: "agent:message",
		Data:  `{"agentId":"test-id","content":"Hello world!"}`,
	}

	updated := model.handleSSEEvent(evt)

	if len(updated.messages) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(updated.messages))
	}
	if updated.messages[0].Role != "agent" {
		t.Errorf("Expected role 'agent', got %q", updated.messages[0].Role)
	}
	if updated.messages[0].Content != "Hello world!" {
		t.Errorf("Expected content 'Hello world!', got %q", updated.messages[0].Content)
	}
}

func TestAppModel_HandleSSEEvent_AgentComplete(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.isAgentRunning = true

	evt := client.SSEEvent{
		Event: "agent:complete",
		Data:  `{"agentId":"test-id"}`,
	}

	updated := model.handleSSEEvent(evt)

	if updated.isAgentRunning {
		t.Error("Expected isAgentRunning to be false after agent:complete")
	}
	if len(updated.messages) != 1 {
		t.Fatalf("Expected 1 system message, got %d", len(updated.messages))
	}
	if !strings.Contains(updated.messages[0].Content, "Agent turn completed") {
		t.Errorf("Expected completion message, got %q", updated.messages[0].Content)
	}
}

func TestAppModel_HandleSSEEvent_AgentError(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.isAgentRunning = true

	evt := client.SSEEvent{
		Event: "agent:error",
		Data:  `{"agentId":"test-id","error":"Something went wrong"}`,
	}

	updated := model.handleSSEEvent(evt)

	if updated.isAgentRunning {
		t.Error("Expected isAgentRunning to be false after agent:error")
	}
	if len(updated.messages) != 1 {
		t.Fatalf("Expected 1 error message, got %d", len(updated.messages))
	}
	if !strings.Contains(updated.messages[0].Content, "Something went wrong") {
		t.Errorf("Expected error content, got %q", updated.messages[0].Content)
	}
}

func TestAppModel_HandleSSEEvent_ToolCall(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")

	evt := client.SSEEvent{
		Event: "tool:call",
		Data:  `{"agentId":"test-id","toolCallId":"tc1","tool":"calculator","args":{"a":5,"b":7}}`,
	}

	updated := model.handleSSEEvent(evt)

	if len(updated.messages) != 1 {
		t.Fatalf("Expected 1 tool message, got %d", len(updated.messages))
	}
	if updated.messages[0].Role != "tool" {
		t.Errorf("Expected role 'tool', got %q", updated.messages[0].Role)
	}
	if !strings.Contains(updated.messages[0].Content, "calculator") {
		t.Errorf("Expected tool name 'calculator' in content, got %q", updated.messages[0].Content)
	}
}

func TestAppModel_HandleSSEEvent_AgentRun(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.isAgentRunning = false

	evt := client.SSEEvent{
		Event: "agent:run",
		Data:  `{"agentId":"test-id"}`,
	}

	updated := model.handleSSEEvent(evt)

	if !updated.isAgentRunning {
		t.Error("Expected isAgentRunning to be true after agent:run")
	}
}

func TestAppModel_Update_KeyEnter_LockedWhileAgentRunning(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.isAgentRunning = true
	model.interactionID = "test-id"
	model.input.SetValue("should not send")

	updated, cmd := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m := updated.(AppModel)

	if cmd != nil {
		t.Error("Expected nil command when agent is running")
	}
	if len(m.messages) != 0 {
		t.Error("Expected no messages to be added when input is locked")
	}
}

func TestAppModel_FullSSEIntegration(t *testing.T) {
	// This test simulates a full flow: create session → SSE connect → send message →
	// receive agent:run, agent:message, agent:complete via SSE
	sseEvents := []mockSSEEvent{
		{Event: "agent:run", Data: `{"agentId":"test-interaction"}`, Delay: 100 * time.Millisecond},
		{Event: "agent:message", Data: `{"agentId":"test-interaction","content":"Hello from the agent!"}`, Delay: 100 * time.Millisecond},
		{Event: "agent:complete", Data: `{"agentId":"test-interaction"}`, Delay: 50 * time.Millisecond},
	}

	ts := newMockHarnessServer(t, sseEvents)
	defer ts.Close()

	harnessClient := newTestHarnessClient(t, ts.URL)

	// Simulate the Bubble Tea model flow manually
	model := NewAppModel(harnessClient, "interactive", "")

	// 1. Simulate session creation
	createCmd := model.createSessionCmd()
	createMsg := createCmd()
	createdID, ok := createMsg.(interactionCreatedMsg)
	if !ok {
		t.Fatalf("Expected interactionCreatedMsg, got %T: %v", createMsg, createMsg)
	}
	if string(createdID) != "test-interaction" {
		t.Fatalf("Expected interaction ID 'test-interaction', got %q", string(createdID))
	}

	// 2. Process the creation message
	updatedModel, _ := model.Update(createdID)
	model = updatedModel.(AppModel)

	if model.interactionID != "test-interaction" {
		t.Fatalf("Expected interactionID to be set, got %q", model.interactionID)
	}

	// 3. Manually invoke startSSE and get the channels
	sseCmd := model.startSSE()
	sseMsg := sseCmd()

	channelsMsg, ok := sseMsg.(sseChannelsReady)
	if !ok {
		t.Fatalf("Expected sseChannelsReady, got %T: %v", sseMsg, sseMsg)
	}

	// 4. Process the sseChannelsReady message — this stores channels on the model
	updatedModel, _ = model.Update(channelsMsg)
	model = updatedModel.(AppModel)

	// 5. Read events — the mock server sends "connected" first, then our test events.
	// We'll read and process events until we see agent:complete.
	eventsRead := 0
	maxEvents := 10

	for eventsRead < maxEvents {
		readCmd := readNextSSECmd(model.sseEvents, model.sseErrs)
		msg := readCmd()

		updatedModel, _ = model.Update(msg)
		model = updatedModel.(AppModel)
		eventsRead++

		// Check if we got agent:complete
		if sseEvt, ok := msg.(sseEventMsg); ok && client.SSEEvent(sseEvt).Event == "agent:complete" {
			break
		}
	}

	// Verify the final model state
	if model.isAgentRunning {
		t.Error("Expected isAgentRunning to be false after agent:complete")
	}

	agentMsgFound := false
	completeMsgFound := false
	for _, m := range model.messages {
		if m.Role == "agent" && strings.Contains(m.Content, "Hello from the agent!") {
			agentMsgFound = true
		}
		if m.Role == "system" && strings.Contains(m.Content, "Agent turn completed") {
			completeMsgFound = true
		}
	}
	if !agentMsgFound {
		t.Error("Expected agent message 'Hello from the agent!' in messages")
	}
	if !completeMsgFound {
		t.Error("Expected system completion message")
	}
}

func TestAppModel_HandleSSEEvent_ToolApprovalRequired(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.interactionID = "test-id"

	evt := client.SSEEvent{
		Event: client.EventToolApprovalReq,
		Data:  `{"agentId":"test-id","toolCallId":"tc-123","tool":"dangerous_tool","args":{"cmd":"rm -rf"}}`,
	}

	updated := model.handleSSEEvent(evt)

	if updated.pendingApproval == nil {
		t.Fatal("Expected pendingApproval to be set")
	}
	if updated.pendingApproval.ToolCallID != "tc-123" {
		t.Errorf("Expected toolCallId tc-123, got %s", updated.pendingApproval.ToolCallID)
	}
	if updated.pendingApproval.Tool != "dangerous_tool" {
		t.Errorf("Expected tool dangerous_tool, got %s", updated.pendingApproval.Tool)
	}
	if len(updated.messages) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(updated.messages))
	}
	if !strings.Contains(updated.messages[0].Content, "dangerous_tool") {
		t.Errorf("Expected dangerous_tool in content: %s", updated.messages[0].Content)
	}
}

func TestAppModel_Update_KeyEnter_ToolApprovalAccept(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.interactionID = "test-id"
	model.isAgentRunning = true
	model.pendingApproval = &PendingToolApproval{
		ToolCallID: "tc-123",
		Tool:       "dangerous_tool",
		Args:       map[string]any{"cmd": "echo hi"},
	}

	model.input.SetValue("yes")
	updated, cmd := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m := updated.(AppModel)

	if cmd == nil {
		t.Fatal("Expected cmd to be returned for sendToolDecisionCmd")
	}
	if m.pendingApproval != nil {
		t.Error("Expected pendingApproval to be cleared after decision")
	}
	found := false
	for _, msg := range m.messages {
		if strings.Contains(msg.Content, "Accepted tool call: dangerous_tool") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected accepted tool call message in messages")
	}
}

func TestAppModel_Update_KeyEnter_ToolApprovalReject(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.interactionID = "test-id"
	model.isAgentRunning = true
	model.pendingApproval = &PendingToolApproval{
		ToolCallID: "tc-123",
		Tool:       "dangerous_tool",
		Args:       map[string]any{"cmd": "echo hi"},
	}

	model.input.SetValue("no")
	updated, cmd := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m := updated.(AppModel)

	if cmd == nil {
		t.Fatal("Expected cmd to be returned for sendToolDecisionCmd")
	}
	if m.pendingApproval != nil {
		t.Error("Expected pendingApproval to be cleared after decision")
	}
	found := false
	for _, msg := range m.messages {
		if strings.Contains(msg.Content, "Rejected tool call: dangerous_tool") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected rejected tool call message in messages")
	}
}

func TestAppModel_HandleSSEEvent_ToolCompleteClearsApproval(t *testing.T) {
	harnessClient := newTestHarnessClient(t, "http://fake:9999")
	model := NewAppModel(harnessClient, "interactive", "")
	model.pendingApproval = &PendingToolApproval{
		ToolCallID: "tc-123",
		Tool:       "dangerous_tool",
	}

	evt := client.SSEEvent{
		Event: client.EventToolComplete,
		Data:  `{"agentId":"test-id","toolCallId":"tc-123","tool":"dangerous_tool","result":{"success":true}}`,
	}

	updated := model.handleSSEEvent(evt)
	if updated.pendingApproval != nil {
		t.Error("Expected pendingApproval to be cleared after tool:complete for matching toolCallId")
	}
}
