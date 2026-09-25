package client

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// SSEEvent represents a single Server-Sent Event.
type SSEEvent struct {
	Event string `json:"event"`
	Data  string `json:"data"`
	ID    string `json:"id,omitempty"`
}

// Common SSE Event types emitted by agentic-harness
const (
	EventMessage    = "agent:message"
	EventToolCall   = "tool:call"
	EventToolResult = "tool:result"
	EventComplete   = "agent:complete"
	EventError      = "error"
)

// ReadSSEStream reads SSE events from an io.Reader and sends them to the returned channel.
func ReadSSEStream(ctx context.Context, r io.Reader) (<-chan SSEEvent, <-chan error) {
	events := make(chan SSEEvent, 32)
	errs := make(chan error, 1)

	go func() {
		defer close(events)
		defer close(errs)

		scanner := bufio.NewScanner(r)
		var currentEvent SSEEvent
		var dataLines []string

		for scanner.Scan() {
			select {
			case <-ctx.Done():
				errs <- ctx.Err()
				return
			default:
			}

			line := scanner.Text()

			// An empty line signals the end of an SSE message
			if line == "" {
				if len(dataLines) > 0 || currentEvent.Event != "" {
					currentEvent.Data = strings.Join(dataLines, "\n")
					if currentEvent.Event == "" {
						currentEvent.Event = "message"
					}
					select {
					case events <- currentEvent:
					case <-ctx.Done():
						errs <- ctx.Err()
						return
					}
					currentEvent = SSEEvent{}
					dataLines = nil
				}
				continue
			}

			// Comment line
			if strings.HasPrefix(line, ":") {
				continue
			}

			parts := strings.SplitN(line, ":", 2)
			field := parts[0]
			value := ""
			if len(parts) > 1 {
				value = strings.TrimPrefix(parts[1], " ")
			}

			switch field {
			case "event":
				currentEvent.Event = value
			case "data":
				dataLines = append(dataLines, value)
			case "id":
				currentEvent.ID = value
			}
		}

		// Flush trailing event if scanner ended without trailing newline
		if len(dataLines) > 0 || currentEvent.Event != "" {
			currentEvent.Data = strings.Join(dataLines, "\n")
			if currentEvent.Event == "" {
				currentEvent.Event = "message"
			}
			events <- currentEvent
		}

		if err := scanner.Err(); err != nil && err != io.EOF {
			errs <- err
		}
	}()

	return events, errs
}

// StreamEvents connects to the harness SSE endpoint for the given interaction ID.
func (c *HarnessClient) StreamEvents(ctx context.Context, interactionID string) (<-chan SSEEvent, <-chan error, error) {
	token, err := c.getValidToken(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get valid token for SSE: %w", err)
	}

	url := fmt.Sprintf("%s/interactions/%s/sse", strings.TrimSuffix(c.baseURL, "/"), interactionID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create SSE request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("SSE connection failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return nil, nil, fmt.Errorf("SSE stream returned status %d: %s", resp.StatusCode, string(body))
	}

	events, errs := ReadSSEStream(ctx, resp.Body)
	return events, errs, nil
}
