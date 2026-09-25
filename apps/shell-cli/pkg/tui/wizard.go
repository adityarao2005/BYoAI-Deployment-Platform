package tui

import (
	"fmt"
	"strings"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/config"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#818CF8")).
			MarginBottom(1)

	headerStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#A7F3D0")).
			Bold(true)

	focusedStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#6366F1"))

	blurredStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#64748B"))

	docStyle = lipgloss.NewStyle().
			Margin(1, 2)

	successStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#34D399")).
			Bold(true)
)

type WizardStep int

const (
	StepHarnessURI WizardStep = iota
	StepOAuthIssuer
	StepOAuthClientID
	StepDefaultMode
	StepComplete
)

type SetupWizardModel struct {
	inputs   []textinput.Model
	focusIdx int
	step     WizardStep
	modes    []string
	modeIdx  int
	config   *config.Config
	err      error
	done     bool
	quitting bool
}

func NewSetupWizard(initialCfg *config.Config) SetupWizardModel {
	if initialCfg == nil {
		initialCfg = config.DefaultConfig()
	}

	inputs := make([]textinput.Model, 3)

	inputs[0] = textinput.New()
	inputs[0].Placeholder = "http://localhost:3000"
	inputs[0].SetValue(initialCfg.AgentHarnessURI)
	inputs[0].Focus()
	inputs[0].Prompt = "  Agent Harness URI: "

	inputs[1] = textinput.New()
	inputs[1].Placeholder = "http://localhost:8080/oauth"
	inputs[1].SetValue(initialCfg.OAuthIssuerURI)
	inputs[1].Prompt = "  OAuth Issuer URI:  "

	inputs[2] = textinput.New()
	inputs[2].Placeholder = "byoai-shell-cli"
	inputs[2].SetValue(initialCfg.OAuthClientID)
	inputs[2].Prompt = "  OAuth Client ID:   "

	return SetupWizardModel{
		inputs:   inputs,
		focusIdx: 0,
		step:     StepHarnessURI,
		modes:    []string{"interactive", "non-interactive"},
		modeIdx:  0,
		config:   initialCfg,
	}
}

func (m SetupWizardModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m SetupWizardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC, tea.KeyEsc:
			m.quitting = true
			return m, tea.Quit

		case tea.KeyTab, tea.KeyDown, tea.KeyEnter:
			if m.focusIdx < len(m.inputs)-1 {
				m.inputs[m.focusIdx].Blur()
				m.focusIdx++
				m.inputs[m.focusIdx].Focus()
				return m, nil
			} else if m.focusIdx == len(m.inputs)-1 && msg.Type == tea.KeyEnter {
				m.focusIdx++
				return m, nil
			} else if m.focusIdx >= len(m.inputs) && msg.Type == tea.KeyEnter {
				// Finish setup
				m.config.AgentHarnessURI = strings.TrimSpace(m.inputs[0].Value())
				m.config.OAuthIssuerURI = strings.TrimSpace(m.inputs[1].Value())
				m.config.OAuthClientID = strings.TrimSpace(m.inputs[2].Value())
				m.config.DefaultMode = m.modes[m.modeIdx]

				cfgPath, _ := config.GetDefaultConfigPath()
				if err := config.SaveConfig(cfgPath, m.config); err != nil {
					m.err = err
				}
				m.done = true
				return m, tea.Quit
			}

		case tea.KeyUp, tea.KeyShiftTab:
			if m.focusIdx > 0 {
				if m.focusIdx < len(m.inputs) {
					m.inputs[m.focusIdx].Blur()
				}
				m.focusIdx--
				m.inputs[m.focusIdx].Focus()
				return m, nil
			}

		case tea.KeyLeft:
			if m.focusIdx >= len(m.inputs) && m.modeIdx > 0 {
				m.modeIdx--
			}

		case tea.KeyRight:
			if m.focusIdx >= len(m.inputs) && m.modeIdx < len(m.modes)-1 {
				m.modeIdx++
			}
		}
	}

	var cmds []tea.Cmd = make([]tea.Cmd, len(m.inputs))
	for i := range m.inputs {
		m.inputs[i], cmds[i] = m.inputs[i].Update(msg)
	}

	return m, tea.Batch(cmds...)
}

func (m SetupWizardModel) View() string {
	if m.quitting {
		return "Setup wizard cancelled.\n"
	}

	if m.done {
		if m.err != nil {
			return fmt.Sprintf("Error saving configuration: %v\n", m.err)
		}
		cfgPath, _ := config.GetDefaultConfigPath()
		return successStyle.Render(fmt.Sprintf("\n✔ Configuration successfully saved to %s\nReady to use BYoAI Shell CLI!\n\n", cfgPath))
	}

	var b strings.Builder
	b.WriteString(titleStyle.Render("╭──────────────────────────────────────────────╮\n│   ✨ Welcome to BYoAI Shell CLI Setup Wizard │\n╰──────────────────────────────────────────────╯"))
	b.WriteString("\n\n")
	b.WriteString(headerStyle.Render("Configure your deployment platform endpoints:\n\n"))

	for i := range m.inputs {
		b.WriteString(m.inputs[i].View())
		b.WriteString("\n")
	}

	b.WriteString("\n  Default Mode:  ")
	for i, mode := range m.modes {
		if i == m.modeIdx {
			b.WriteString(focusedStyle.Render(fmt.Sprintf("[ %s ] ", mode)))
		} else {
			b.WriteString(blurredStyle.Render(fmt.Sprintf("  %s   ", mode)))
		}
	}

	b.WriteString("\n\n")
	b.WriteString(blurredStyle.Render("  (Use Tab/Enter to navigate, Arrow keys to choose mode, Ctrl+C to exit)"))
	b.WriteString("\n")

	return docStyle.Render(b.String())
}

// RunWizard launches the setup TUI and returns the saved config.
func RunWizard(initialCfg *config.Config) (*config.Config, error) {
	model := NewSetupWizard(initialCfg)
	p := tea.NewProgram(model)
	finalModel, err := p.Run()
	if err != nil {
		return nil, fmt.Errorf("failed to run setup wizard: %w", err)
	}

	wModel, ok := finalModel.(SetupWizardModel)
	if !ok || wModel.quitting {
		return nil, fmt.Errorf("wizard was cancelled")
	}

	if wModel.err != nil {
		return nil, wModel.err
	}

	return wModel.config, nil
}
