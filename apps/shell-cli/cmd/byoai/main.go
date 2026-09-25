package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/auth"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/client"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/shell_cli/pkg/tui"
	tea "github.com/charmbracelet/bubbletea"
)

var (
	version = "0.1.0-dev"
)

func main() {
	var (
		configPath     string
		interactive    bool
		nonInteractive bool
		runSetup       bool
		runLogin       bool
		showVersion    bool
	)

	flag.StringVar(&configPath, "config", "", "Path to custom configuration file")
	flag.BoolVar(&interactive, "i", false, "Start in interactive mode")
	flag.BoolVar(&interactive, "interactive", false, "Start in interactive mode")
	flag.BoolVar(&nonInteractive, "n", false, "Run prompt in non-interactive batch mode")
	flag.BoolVar(&nonInteractive, "non-interactive", false, "Run prompt in non-interactive batch mode")
	flag.BoolVar(&runSetup, "setup", false, "Run the interactive configuration setup wizard")
	flag.BoolVar(&runLogin, "login", false, "Perform OAuth login flow")
	flag.BoolVar(&showVersion, "v", false, "Show version")
	flag.BoolVar(&showVersion, "version", false, "Show version")

	flag.Usage = func() {
		fmt.Printf("BYoAI Shell CLI (v%s)\n\n", version)
		fmt.Println("Usage:")
		fmt.Println("  byoai [options] [prompt]")
		fmt.Println("\nOptions:")
		flag.PrintDefaults()
	}

	flag.Parse()

	if showVersion {
		fmt.Printf("byoai version %s\n", version)
		os.Exit(0)
	}

	resolvedPath := configPath
	if resolvedPath == "" {
		defaultPath, err := config.GetDefaultConfigPath()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error determining config path: %v\n", err)
			os.Exit(1)
		}
		resolvedPath = defaultPath
	}

	// First-run detection or explicit setup flag
	if runSetup || !config.ConfigExists(resolvedPath) {
		fmt.Println("Launching configuration setup wizard...")
		var initialCfg *config.Config
		if config.ConfigExists(resolvedPath) {
			initialCfg, _ = config.LoadConfig(resolvedPath)
		}
		cfg, err := tui.RunWizard(initialCfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Setup failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("Configuration initialized. Harness: %s\n", cfg.AgentHarnessURI)
		return
	}

	cfg, err := config.LoadConfig(resolvedPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	tokenStore, err := auth.NewTokenStore("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize token store: %v\n", err)
		os.Exit(1)
	}

	pkceCfg := auth.PKCEFlowConfig{
		IssuerURI: cfg.OAuthIssuerURI,
		ClientID:  cfg.OAuthClientID,
		Scopes:    cfg.OAuthScopes,
	}

	// Login flag or check existing tokens
	tokens, _ := tokenStore.Load()
	if runLogin || (tokens == nil && cfg.OAuthIssuerURI != "") {
		fmt.Println("Authenticating with OAuth provider...")
		result, err := auth.RunPKCEFlow(context.Background(), pkceCfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Authentication failed: %v\n", err)
			os.Exit(1)
		}
		if err := tokenStore.SaveFromPKCEResult(result); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to save tokens: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("✔ Successfully authenticated!")
		if runLogin {
			return
		}
	}

	promptArgs := flag.Args()
	prompt := strings.Join(promptArgs, " ")

	selectedMode := cfg.DefaultMode
	if interactive {
		selectedMode = "interactive"
	} else if nonInteractive {
		selectedMode = "non-interactive"
	}

	harnessClient := client.NewHarnessClient(cfg.AgentHarnessURI, tokenStore, &pkceCfg)
	model := tui.NewAppModel(harnessClient, selectedMode, prompt)

	p := tea.NewProgram(model, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running Shell CLI: %v\n", err)
		os.Exit(1)
	}
}
