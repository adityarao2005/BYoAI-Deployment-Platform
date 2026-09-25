package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/auth"
)

func TestReadSSEStream(t *testing.T) {
	ssePayload := "event: agent:message\ndata: {\"text\":\"Hello from agent\"}\n\nevent: tool:call\ndata: {\"tool\":\"bash\",\"args\":{\"command\":\"ls\"}}\n\nevent: agent:complete\ndata: {}\n\n"

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	events, errs := ReadSSEStream(ctx, strings.NewReader(ssePayload))

	var collected []SSEEvent
	for evt := range events {
		collected = append(collected, evt)
	}

	for err := range errs {
		if err != nil {
			t.Fatalf("Unexpected SSE error: %v", err)
		}
	}

	if len(collected) != 3 {
		t.Fatalf("Expected 3 events, got %d", len(collected))
	}

	if collected[0].Event != EventMessage {
		t.Errorf("Expected event %q, got %q", EventMessage, collected[0].Event)
	}
	if !strings.Contains(collected[0].Data, "Hello from agent") {
		t.Errorf("Unexpected data in event 0: %s", collected[0].Data)
	}

	if collected[1].Event != EventToolCall {
		t.Errorf("Expected event %q, got %q", EventToolCall, collected[1].Event)
	}

	if collected[2].Event != EventComplete {
		t.Errorf("Expected event %q, got %q", EventComplete, collected[2].Event)
	}
}

func TestHarnessClient_CRUD(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer valid-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/interactions":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "test-interaction-123"})
		case r.Method == http.MethodPost && r.URL.Path == "/interactions/test-interaction-123":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
		case r.Method == http.MethodGet && r.URL.Path == "/interactions/test-interaction-123":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(InteractionDetail{
				ID:     "test-interaction-123",
				UserID: "user-1",
				Mode:   "interactive",
				Transcript: []TranscriptItem{
					{Role: "user", Content: "hi"},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/interactions":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]InteractionSummary{{ID: "test-interaction-123"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	dir := t.TempDir()
	store := &auth.TokenStore{Path: filepath.Join(dir, "tokens.json")}
	_ = store.Save(&auth.StoredTokens{
		AccessToken: "valid-token",
		Expiry:      time.Now().Add(1 * time.Hour),
	})

	client := NewHarnessClient(ts.URL, store, nil)
	ctx := context.Background()

	// 1. Create Interaction
	created, err := client.CreateInteraction(ctx, "interactive")
	if err != nil {
		t.Fatalf("CreateInteraction failed: %v", err)
	}
	if created.ID != "test-interaction-123" {
		t.Errorf("Expected id test-interaction-123, got %s", created.ID)
	}

	// 2. Send Message
	err = client.SendMessage(ctx, created.ID, "hello")
	if err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	// 3. Get Interaction
	detail, err := client.GetInteraction(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetInteraction failed: %v", err)
	}
	if detail.ID != "test-interaction-123" || len(detail.Transcript) != 1 {
		t.Errorf("Unexpected detail: %+v", detail)
	}

	// 4. List Interactions
	list, err := client.ListInteractions(ctx)
	if err != nil {
		t.Fatalf("ListInteractions failed: %v", err)
	}
	if len(list) != 1 || list[0].ID != "test-interaction-123" {
		t.Errorf("Unexpected list: %+v", list)
	}
}
