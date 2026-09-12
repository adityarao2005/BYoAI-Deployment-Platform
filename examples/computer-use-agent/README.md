# Computer Use Agent Example

This example demonstrates how to configure and run an AI Agent with direct **Computer Use** capabilities using the `@byo-ai-agent-platform` harness.

---

## Capabilities

When configured with a `computer` tool provider, the agent receives native execution primitives:
- **Command Execution**: Run bash commands, inspect outputs, and check exit codes.
- **Filesystem Access**: Read, write, and list files and directories.
- **Sandboxed Sessions**: Session-scoped environments ensuring state isolation across agent interactions.

---

## Directory Structure

```
examples/computer-use-agent/
├── README.md        # This documentation
├── agent.yaml       # Computer use agent configuration
└── run-agent.sh     # Launch script
```

---

## Configuration

In `agent.yaml`, the `toolProviders` section declares the computer provider:

### Local Execution (Current Default)
Executes directly on the host machine:
```yaml
toolProviders:
  - type: computer
    provider:
      type: local
      enableGUIToolsIfAvailable: false
```

### Remote Execution (via `computer_controller`)
Connects to the Golang-based `computer_controller` daemon over ConnectRPC to spawn isolated Docker sandboxes:
```yaml
toolProviders:
  - type: computer
    provider:
      type: remote
      url: "http://localhost:8080"
      image: "ubuntu:latest"
      enableGUIToolsIfAvailable: false
      networkRules:
        allowedHosts: "*"
```

---

## Prerequisites

- [Bun](https://bun.sh/) (v1.0 or later)
- A valid **Gemini API Key** (`GEMINI_API_KEY`)

---

## How to Run

Provide your `GEMINI_API_KEY` and start the agent:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
./run-agent.sh
```

Or as a single command:

```bash
GEMINI_API_KEY="your-gemini-api-key" ./run-agent.sh
```

> **Note**: Do not run untrusted prompts against the local computer provider without appropriate sandboxing. For isolated execution, spin up `computer_controller/` with Docker provider mode enabled.
