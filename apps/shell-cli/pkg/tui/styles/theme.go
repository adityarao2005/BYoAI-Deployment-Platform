package styles

import "github.com/charmbracelet/lipgloss"

var (
	// Brand and Accent Colors
	PrimaryColor   = lipgloss.Color("#6366F1") // Indigo
	SecondaryColor = lipgloss.Color("#06B6D4") // Cyan
	SuccessColor   = lipgloss.Color("#10B981") // Emerald
	WarningColor   = lipgloss.Color("#F59E0B") // Amber
	ErrorColor     = lipgloss.Color("#EF4444") // Red
	BgDarkColor    = lipgloss.Color("#0F172A") // Slate 900
	MutedColor     = lipgloss.Color("#64748B") // Slate 500
	BorderColor    = lipgloss.Color("#334155") // Slate 700

	// Styles
	AppContainer = lipgloss.NewStyle().
			Padding(0, 1)

	HeaderStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#F8FAFC")).
			Background(lipgloss.Color("#1E1B4B")).
			Padding(0, 1).
			MarginBottom(1)

	BadgeInteractive = lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("#FFFFFF")).
				Background(PrimaryColor).
				Padding(0, 1)

	BadgeNonInteractive = lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("#FFFFFF")).
				Background(lipgloss.Color("#475569")).
				Padding(0, 1)

	UserMessageBubble = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#FFFFFF")).
				Background(lipgloss.Color("#312E81")).
				Padding(0, 1).
				MarginBottom(1).
				BorderLeft(true).
				BorderStyle(lipgloss.ThickBorder()).
				BorderForeground(PrimaryColor)

	AgentMessageBubble = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#F1F5F9")).
				Background(lipgloss.Color("#0F172A")).
				Padding(0, 1).
				MarginBottom(1).
				BorderLeft(true).
				BorderStyle(lipgloss.ThickBorder()).
				BorderForeground(SecondaryColor)

	ToolCallBubble = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FDE68A")).
			Background(lipgloss.Color("#1E293B")).
			Padding(0, 1).
			MarginBottom(1).
			Italic(true)

	StatusBar = lipgloss.NewStyle().
			Foreground(MutedColor).
			MarginTop(1)

	LockedInputNotice = lipgloss.NewStyle().
				Foreground(WarningColor).
				Bold(true)
)
