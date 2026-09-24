# Docker Computer Use Agent Example

This example demonstrates how to run an AI Agent with **Docker Container Computer Use** capabilities connected remotely to `apps/computer_controller/` over ConnectRPC.

---

## Capabilities & Architecture

When configured with a remote `computer` tool provider in Docker mode:
- **Container Isolation**: Commands and filesystem actions are executed inside an isolated Docker container (e.g., `alpine:latest`).
- **Daemon-Managed Lifecycle**: The `apps/computer_controller` daemon provisions, executes, and cleans up Docker sandbox containers via ConnectRPC (`http://localhost:8080`).
- **Security & Token Authentication**: ConnectRPC communication between the agent harness and computer controller is secured using a `bearerToken` (`apiKey`).

---

## Directory Structure

```
examples/docker-computer-use/
├── README.md        # This documentation
├── agent.yaml       # Harness agent configuration (remote computer provider)
├── computer.yaml    # Computer controller configuration (docker mode)
└── run-agent.sh     # Launch script for the agent harness
```

---

## Configuration Reference

### 1. Computer Controller (`computer.yaml`)

Defines Docker execution mode and bearer token security for the computer controller daemon:

```yaml
type: docker
server:
  host: "0.0.0.0"
  port: 8080
  security:
    bearerToken: "apiKey"
```

### 2. Agent Harness (`agent.yaml`)

Defines the Gemini LLM model and remote computer tool provider connecting to `http://localhost:8080`:

```yaml
name: Gemini
description: You are a general purpose agent with access to a computer.
models:
  - name: gemini-3.7-flash
    brand: gemini
    properties:
      apiKey: "${GEMINI_API_KEY}"

toolProviders:
  - type: computer
    provider:
      type: remote
      url: http://localhost:8080
      image: "alpine:latest"
      enableGUIToolsIfAvailable: false
      security:
        bearerToken: "apiKey"
```

---

## Prerequisites

- [Bun](https://bun.sh/) (v1.0 or later)
- Active **Docker Daemon** running locally or accessible via `DOCKER_HOST`
- A valid **Gemini API Key** (`GEMINI_API_KEY`)

---

## Quickstart

### Step 1: Start Computer Controller Daemon in Docker Mode

In a terminal window, navigate to `apps/computer_controller/` and run the controller service with the provided `computer.yaml`:

```bash
cd apps/computer_controller
cp ../../examples/docker-computer-use/computer.yaml ./computer.yaml
task run
```

The controller daemon will start listening on `0.0.0.0:8080` in Docker provider mode.

### Step 2: Run the Agent

In another terminal window, run `run-agent.sh` providing your `GEMINI_API_KEY`:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
./examples/docker-computer-use/run-agent.sh
```

Or as a single command from `examples/docker-computer-use/`:

```bash
cd examples/docker-computer-use
GEMINI_API_KEY="your-gemini-api-key" ./run-agent.sh
```
