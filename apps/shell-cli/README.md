# Shell CLI (`apps/shell-cli`)

Interactive Terminal User Interface (TUI) and batch CLI for interacting with autonomous AI agents.

## Features
- **Bubble Tea v2 TUI**: Smooth terminal interface with scrolling message history, status bar, and spinners.
- **Lip Gloss v2 Theming**: Rich color scheme with badges for Interactive vs. Non-Interactive modes.
- **Public OAuth2 Client with PKCE**: Browser-based login with ephemeral localhost callback server and token persistence at `~/.byoai/tokens.json`.
- **First-Run Setup Wizard**: Interactive TUI wizard automatically launches if no configuration file exists.
- **SSE Stream Reader**: Consumes real-time agent output, tool calls, and completion notifications.
- **Input Locking**: Locks prompt input while an agent is executing until `agent:complete` arrives.

## Configuration File (`~/.byoai/config.yaml`)

```yaml
agentHarnessUri: "http://localhost:3000"
oauthIssuerUri: "http://localhost:8080/oauth"
oauthClientId: "byoai-shell-cli"
oauthScopes:
  - openid
  - profile
defaultMode: "interactive" # or "non-interactive"
```

## CLI Usage

```bash
# Start interactive TUI
byoai

# Run in non-interactive batch mode with an initial prompt
byoai -n "Analyze repository dependencies and report out-of-date packages"

# Force configuration setup wizard
byoai --setup

# Perform OAuth login
byoai --login
```

## Development & Execution

```bash
# Run unit tests
task shell_cli:test

# Build binary
task shell_cli:build

# Run locally
task shell_cli:run
```
