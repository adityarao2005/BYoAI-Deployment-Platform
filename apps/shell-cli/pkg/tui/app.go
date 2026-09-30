package tui

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/client"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/tui/styles"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// DisplayMessage represents a single rendered message in the chat viewport.
type DisplayMessage struct {
	Role    string // "user", "agent", "tool", "system"
	Content string
}

// ─── Bubble Tea Messages ─────────────────────────────────────────────

type sseEventMsg client.SSEEvent
type sseErrMsg struct{ err error }
type sseStreamEndMsg struct{}
type interactionCreatedMsg string
type sendMsgSuccess struct{}
type sendMsgErrMsg struct{ err error }

// ─── Model ───────────────────────────────────────────────────────────

// AppModel is the Bubble Tea model for the interactive shell TUI.
type AppModel struct {
	client        *client.HarnessClient
	interactionID string
	mode          string // "interactive" or "non-interactive"
	messages      []DisplayMessage
	input         textinput.Model
	viewport      viewport.Model
	spinner       spinner.Model

	isAgentRunning bool
	initialPrompt  string
	width          int
	height         int
	err            error
	quitting       bool
	ready          bool

	// SSE lifecycle
	sseCtx    context.Context
	sseCancel context.CancelFunc
	sseEvents <-chan client.SSEEvent
	sseErrs   <-chan error
}

// NewAppModel creates a fresh AppModel for the given harness client.
func NewAppModel(harnessClient *client.HarnessClient, mode string, initialPrompt string) AppModel {
	ti := textinput.New()
	ti.Placeholder = "Type a message..."
	ti.Focus()
	ti.Prompt = "❯ "

	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(styles.SecondaryColor)

	return AppModel{
		client:         harnessClient,
		mode:           mode,
		initialPrompt:  initialPrompt,
		input:          ti,
		spinner:        sp,
		isAgentRunning: false,
	}
}

func (m AppModel) Init() tea.Cmd {
	return tea.Batch(
		textinput.Blink,
		m.spinner.Tick,
		m.createSessionCmd(),
	)
}

// ─── Commands ────────────────────────────────────────────────────────

// createSessionCmd creates an interaction session on the harness.
func (m AppModel) createSessionCmd() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		resp, err := m.client.CreateInteraction(ctx, m.mode)
		if err != nil {
			return sendMsgErrMsg{err: err}
		}
		return interactionCreatedMsg(resp.ID)
	}
}

// sendPromptCmd sends a user message to the harness (fire-and-forget).
func (m AppModel) sendPromptCmd(prompt string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		err := m.client.SendMessage(ctx, m.interactionID, prompt)
		if err != nil {
			return sendMsgErrMsg{err: err}
		}
		return sendMsgSuccess{}
	}
}

// startSSECmd opens the SSE stream and stores the channels on the model.
// It returns the first event (or error) as a tea.Msg and the model's sseEvents
// and sseErrs channels are used by readNextSSECmd to continue reading.
func (m *AppModel) startSSE() tea.Cmd {
	ctx, cancel := context.WithCancel(context.Background())
	m.sseCtx = ctx
	m.sseCancel = cancel

	return func() tea.Msg {
		events, errs, err := m.client.StreamEvents(ctx, m.interactionID)
		if err != nil {
			return sseErrMsg{err: err}
		}

		// We can't store channels in a tea.Msg, so we use a closure
		// that captures these channels for the recursive read pattern.
		// But we need to get channels into the model — return a special
		// msg that carries them.
		return sseChannelsReady{events: events, errs: errs}
	}
}

// sseChannelsReady carries the SSE channels to the model after connection.
type sseChannelsReady struct {
	events <-chan client.SSEEvent
	errs   <-chan error
}

// readNextSSECmd reads the next event from the SSE channels stored on the model.
func readNextSSECmd(events <-chan client.SSEEvent, errs <-chan error) tea.Cmd {
	return func() tea.Msg {
		select {
		case evt, ok := <-events:
			if !ok {
				return sseStreamEndMsg{}
			}
			return sseEventMsg(evt)
		case err, ok := <-errs:
			if !ok {
				return sseStreamEndMsg{}
			}
			if err != nil {
				return sseErrMsg{err: err}
			}
			return sseStreamEndMsg{}
		}
	}
}

// ─── Update ──────────────────────────────────────────────────────────

func (m AppModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		headerHeight := 3
		inputHeight := 3
		vpHeight := m.height - headerHeight - inputHeight
		if vpHeight < 5 {
			vpHeight = 5
		}

		if !m.ready {
			m.viewport = viewport.New(msg.Width-4, vpHeight)
			m.viewport.SetContent(m.renderMessages())
			m.ready = true
		} else {
			m.viewport.Width = msg.Width - 4
			m.viewport.Height = vpHeight
			m.viewport.SetContent(m.renderMessages())
		}

	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC, tea.KeyEsc:
			m.quitting = true
			if m.sseCancel != nil {
				m.sseCancel()
			}
			return m, tea.Quit

		case tea.KeyEnter:
			if m.isAgentRunning {
				// Locked: cannot send while agent is running
				return m, nil
			}

			if m.mode == "non-interactive" && len(m.messages) > 0 {
				// Non-interactive mode allows only 1 turn
				return m, nil
			}

			text := strings.TrimSpace(m.input.Value())
			if text == "" {
				return m, nil
			}

			m.messages = append(m.messages, DisplayMessage{
				Role:    "user",
				Content: text,
			})
			m.input.SetValue("")
			m.isAgentRunning = true
			m.viewport.SetContent(m.renderMessages())
			m.viewport.GotoBottom()

			if m.interactionID != "" {
				cmds = append(cmds, m.sendPromptCmd(text))
			}
			return m, tea.Batch(cmds...)
		}

	case interactionCreatedMsg:
		m.interactionID = string(msg)
		m.messages = append(m.messages, DisplayMessage{
			Role:    "system",
			Content: fmt.Sprintf("Session created: %s (%s)", m.interactionID, m.mode),
		})
		m.viewport.SetContent(m.renderMessages())

		// Start the SSE stream now that we have an interaction ID
		cmds = append(cmds, m.startSSE())

		// If an initial prompt was passed from CLI args, send it now
		if m.initialPrompt != "" {
			m.messages = append(m.messages, DisplayMessage{
				Role:    "user",
				Content: m.initialPrompt,
			})
			m.isAgentRunning = true
			m.viewport.SetContent(m.renderMessages())
			m.viewport.GotoBottom()
			cmds = append(cmds, m.sendPromptCmd(m.initialPrompt))
			m.initialPrompt = ""
		}

	case sseChannelsReady:
		// SSE connection established — store channels and start reading
		m.sseEvents = msg.events
		m.sseErrs = msg.errs
		cmds = append(cmds, readNextSSECmd(m.sseEvents, m.sseErrs))

	case sseEventMsg:
		evt := client.SSEEvent(msg)
		m = m.handleSSEEvent(evt)
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()
		// Chain: read the next SSE event
		if m.sseEvents != nil {
			cmds = append(cmds, readNextSSECmd(m.sseEvents, m.sseErrs))
		}

	case sseErrMsg:
		m.err = msg.err
		m.messages = append(m.messages, DisplayMessage{
			Role:    "system",
			Content: fmt.Sprintf("⚠ SSE error: %v", msg.err),
		})
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()
		// Try to continue reading despite error
		if m.sseEvents != nil {
			cmds = append(cmds, readNextSSECmd(m.sseEvents, m.sseErrs))
		}

	case sseStreamEndMsg:
		m.messages = append(m.messages, DisplayMessage{
			Role:    "system",
			Content: "⚠ SSE stream ended unexpectedly.",
		})
		m.isAgentRunning = false
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()

	case sendMsgSuccess:
		// Message sent successfully — agent is now processing.
		// isAgentRunning was already set to true when the user pressed Enter.
		// State will be updated by SSE events (agent:complete / agent:error).

	case sendMsgErrMsg:
		m.err = msg.err
		m.isAgentRunning = false
		m.messages = append(m.messages, DisplayMessage{
			Role:    "system",
			Content: fmt.Sprintf("❌ Error: %v", m.err),
		})
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)
	}

	if !m.isAgentRunning && !(m.mode == "non-interactive" && len(m.messages) > 0) {
		var inputCmd tea.Cmd
		m.input, inputCmd = m.input.Update(msg)
		cmds = append(cmds, inputCmd)
	}

	var vpCmd tea.Cmd
	m.viewport, vpCmd = m.viewport.Update(msg)
	cmds = append(cmds, vpCmd)

	return m, tea.Batch(cmds...)
}

// handleSSEEvent processes a single SSE event and updates the model state.
func (m AppModel) handleSSEEvent(evt client.SSEEvent) AppModel {
	switch evt.Event {
	case client.EventMessage:
		// agent:message — extract content from JSON payload
		var dataMap map[string]any
		content := evt.Data
		if err := json.Unmarshal([]byte(evt.Data), &dataMap); err == nil {
			if text, ok := dataMap["content"].(string); ok {
				content = text
			} else if text, ok := dataMap["text"].(string); ok {
				content = text
			}
		}
		m.messages = append(m.messages, DisplayMessage{
			Role:    "agent",
			Content: content,
		})

	case "user:message":
		// user:message from SSE — these are replays of history, skip
		// if we already have the message shown (optimistic add).

	case "agent:run":
		m.isAgentRunning = true

	case client.EventToolCall:
		var dataMap map[string]any
		toolInfo := evt.Data
		if err := json.Unmarshal([]byte(evt.Data), &dataMap); err == nil {
			if name, ok := dataMap["tool"].(string); ok {
				toolInfo = name
				if args, ok := dataMap["args"]; ok {
					argsJSON, _ := json.Marshal(args)
					toolInfo = fmt.Sprintf("%s(%s)", name, string(argsJSON))
				}
			}
		}
		m.messages = append(m.messages, DisplayMessage{
			Role:    "tool",
			Content: fmt.Sprintf("🛠 Tool Call: %s", toolInfo),
		})

	case "tool:complete":
		var dataMap map[string]any
		resultInfo := evt.Data
		if err := json.Unmarshal([]byte(evt.Data), &dataMap); err == nil {
			if name, ok := dataMap["tool"].(string); ok {
				resultInfo = fmt.Sprintf("%s → done", name)
				if result, ok := dataMap["result"]; ok {
					resultJSON, _ := json.Marshal(result)
					summary := string(resultJSON)
					if len(summary) > 120 {
						summary = summary[:120] + "…"
					}
					resultInfo = fmt.Sprintf("%s → %s", name, summary)
				}
			}
		}
		m.messages = append(m.messages, DisplayMessage{
			Role:    "tool",
			Content: fmt.Sprintf("✅ Tool Result: %s", resultInfo),
		})

	case client.EventComplete:
		m.isAgentRunning = false
		m.messages = append(m.messages, DisplayMessage{
			Role:    "system",
			Content: "✔ Agent turn completed.",
		})

	case "agent:error":
		m.isAgentRunning = false
		var dataMap map[string]any
		errText := evt.Data
		if err := json.Unmarshal([]byte(evt.Data), &dataMap); err == nil {
			if e, ok := dataMap["error"].(string); ok {
				errText = e
			}
		}
		m.messages = append(m.messages, DisplayMessage{
			Role:    "system",
			Content: fmt.Sprintf("❌ Agent error: %s", errText),
		})

	case "connected", "ping":
		// Lifecycle events — silently ignored

	default:
		// Unknown event type — log for debugging
		m.messages = append(m.messages, DisplayMessage{
			Role:    "system",
			Content: fmt.Sprintf("📡 %s: %s", evt.Event, evt.Data),
		})
	}

	return m
}

// ─── View ────────────────────────────────────────────────────────────

func (m AppModel) renderMessages() string {
	var b strings.Builder
	for _, msg := range m.messages {
		switch msg.Role {
		case "user":
			b.WriteString(styles.UserMessageBubble.Render("You: " + msg.Content))
			b.WriteString("\n\n")
		case "agent":
			b.WriteString(styles.AgentMessageBubble.Render("AI Agent:\n" + msg.Content))
			b.WriteString("\n\n")
		case "tool":
			b.WriteString(styles.ToolCallBubble.Render(msg.Content))
			b.WriteString("\n\n")
		case "system":
			b.WriteString(lipgloss.NewStyle().Foreground(styles.MutedColor).Italic(true).Render(msg.Content))
			b.WriteString("\n\n")
		}
	}
	return b.String()
}

func (m AppModel) View() string {
	if m.quitting {
		return "Exiting BYoAI Shell CLI. Goodbye!\n"
	}

	var b strings.Builder

	// Header
	modeBadge := styles.BadgeInteractive.Render("⚡ INTERACTIVE")
	if m.mode == "non-interactive" {
		modeBadge = styles.BadgeNonInteractive.Render("⏱ NON-INTERACTIVE")
	}

	header := styles.HeaderStyle.Render(fmt.Sprintf("BYoAI Shell │ Session: %s │ %s", m.interactionID, modeBadge))
	b.WriteString(header)
	b.WriteString("\n")

	// Viewport
	b.WriteString(m.viewport.View())
	b.WriteString("\n")

	// Input area & status
	if m.isAgentRunning {
		b.WriteString(styles.LockedInputNotice.Render(fmt.Sprintf("%s Agent is processing... Input is locked until agent:complete", m.spinner.View())))
		b.WriteString("\n")
	} else if m.mode == "non-interactive" && len(m.messages) > 0 {
		b.WriteString(styles.LockedInputNotice.Render("🔒 Non-interactive mode complete. Transcript is read-only (Ctrl+C to quit)."))
		b.WriteString("\n")
	} else {
		b.WriteString(m.input.View())
		b.WriteString("\n")
	}

	b.WriteString(styles.StatusBar.Render("Press Enter to send, Ctrl+C to quit"))

	return styles.AppContainer.Render(b.String())
}
