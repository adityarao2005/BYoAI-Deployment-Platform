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

type DisplayMessage struct {
	Role    string // "user", "agent", "tool", "system"
	Content string
}

type sseEventMsg client.SSEEvent
type sseErrMsg error
type interactionCreatedMsg string
type sendMsgSuccess struct{}
type sendMsgErrMsg error

type AppModel struct {
	client         *client.HarnessClient
	interactionID  string
	mode           string // "interactive" or "non-interactive"
	messages       []DisplayMessage
	input          textinput.Model
	viewport       viewport.Model
	spinner        spinner.Model
	isAgentRunning bool
	initialPrompt  string
	width          int
	height         int
	err            error
	quitting       bool
	ready          bool
}

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

func (m AppModel) createSessionCmd() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		resp, err := m.client.CreateInteraction(ctx, m.mode)
		if err != nil {
			return sendMsgErrMsg(err)
		}
		return interactionCreatedMsg(resp.ID)
	}
}

func (m AppModel) sendPromptCmd(prompt string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		err := m.client.SendMessage(ctx, m.interactionID, prompt)
		if err != nil {
			return sendMsgErrMsg(err)
		}
		return sendMsgSuccess{}
	}
}

func listenSSECmd(harnessClient *client.HarnessClient, interactionID string) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		events, errs, err := harnessClient.StreamEvents(ctx, interactionID)
		if err != nil {
			return sseErrMsg(err)
		}

		go func() {
			for {
				select {
				case evt, ok := <-events:
					if !ok {
						return
					}
					// Will be dispatched via sub-channel if needed
					_ = evt
				case err, ok := <-errs:
					if !ok {
						return
					}
					_ = err
				}
			}
		}()

		// Read first event synchronously for tea loop
		select {
		case evt, ok := <-events:
			if ok {
				return sseEventMsg(evt)
			}
		case err, ok := <-errs:
			if ok && err != nil {
				return sseErrMsg(err)
			}
		}
		return nil
	}
}

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

	case sseEventMsg:
		evt := client.SSEEvent(msg)
		switch evt.Event {
		case client.EventMessage:
			var dataMap map[string]any
			content := evt.Data
			if err := json.Unmarshal([]byte(evt.Data), &dataMap); err == nil {
				if text, ok := dataMap["text"].(string); ok {
					content = text
				} else if c, ok := dataMap["content"].(string); ok {
					content = c
				}
			}
			m.messages = append(m.messages, DisplayMessage{
				Role:    "agent",
				Content: content,
			})
			m.isAgentRunning = true
		case client.EventToolCall:
			m.messages = append(m.messages, DisplayMessage{
				Role:    "tool",
				Content: fmt.Sprintf("🛠 Tool Call: %s", evt.Data),
			})
		case client.EventComplete:
			m.isAgentRunning = false
			m.messages = append(m.messages, DisplayMessage{
				Role:    "system",
				Content: "✔ Agent turn completed.",
			})
		}
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()

	case sendMsgSuccess:
		// Message sent successfully, wait for SSE events
		m.isAgentRunning = true

	case sendMsgErrMsg:
		m.err = error(msg)
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
