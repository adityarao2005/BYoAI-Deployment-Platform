# Agentic Harness (`@byo-ai-agent-platform/agentic-harness`)

The **Agentic Harness** is the CLI runtime application for the platform. It loads agent configurations from YAML (`agent.yaml`), registers configured models, skill repositories, tool providers, and computer sandboxes, and executes the interactive agent lifecycle loop.

---

## Getting Started

### Installation
Dependencies are managed via the monorepo root or Bun workspace:

```bash
bun install
```

### Running the Harness

**Using root `task` command (Recommended):**
```bash
task run_harness
```

**Using `bun` directly:**
```bash
cd @byo-ai-agent-platform
bun run --cwd apps/agentic-harness src/index.ts
```

---

## HTTP API Endpoints

The harness exposes a Hono HTTP server with the following endpoints:

- `GET /health` - Health check status
- `POST /interactions` - Create a new agent interaction session
- `GET /interactions` - List all agent interaction IDs
- `GET /interactions/:id` - Retrieve agent interaction memory and transcript
- `POST /interactions/:id` - Post a user message to the agent interaction
- `GET /interactions/:id/sse` - Subscribe to real-time Server-Sent Events (SSE) for the agent interaction (`user:message`, `agent:message`, `agent:run`, `agent:complete`, `tool:call`, `tool:complete`)

---

## Configuration (`agent.yaml`)

The harness automatically resolves configuration files in the following order of precedence:

1. **`AGENT_CONFIG_PATH` environment variable** (highest priority override)
2. **Local file**: `./agent.yaml` in the current working directory
3. **System file**: `/etc/agent/agent.yaml` (Linux/container standard path)

### Environment Variable Interpolation

`agent.yaml` supports environment variable expansion directly in the file:
- **Basic variable**: `${API_KEY}`
- **Fallback default**: `${MAX_TOKENS:-4096}`

If an environment variable is unset and no default is specified, it evaluates to an empty string `""`.

---

## Configuration Reference & Schema

Below is the structure of `agent.yaml`:

```yaml
# Agent Identity (Optional)
name: my-autonomous-agent
description: "An agent equipped with OpenAPI tools, skills, and computer execution."

# Models (Required)
# Registers LLM providers. Note: Multi-model routing/fallback is currently not supported;
# the harness uses the first valid registered model in this list as the active model for the agent.
models:
  - name: gpt-4o
    brand: openai
    properties:
      apiKey: ${OPENAI_API_KEY}

  - name: gemini-1.5-pro
    brand: gemini
    properties:
      apiKey: ${GEMINI_API_KEY}

  - name: claude-3-5-sonnet
    brand: anthropic
    properties:
      apiKey: ${ANTHROPIC_API_KEY}
      maxTokens: 4096

  - name: local-llama
    brand: self_hosted
    properties:
      baseUrl: "http://localhost:8080/v1"
      apiKey: ${LOCAL_LLM_API_KEY:-""}

# Skill Repositories (Optional)
# Load skill packs containing SKILL.md guidelines and scripts.
skillRepositories:
  - type: zip
    location: "https://example.com/skills/pet-skills.zip"
    skillsSubdirectory: "/"

  - type: git
    url: "git@github.com:example/agent-skills.git"
    branch: main
    skillsSubdirectory: "/skills"
    auth:
      method: ssh
      privateKeyPath: "~/.ssh/id_ed25519"

# Tool Providers (Optional)
# Equip the agent with external capabilities (OpenAPI, Computer Use, MCP).
toolProviders:
  # 1. Computer Execution Tool Provider (Local or Remote sandbox)
  - type: computer
    provider:
      type: local
      enableGUIToolsIfAvailable: true

  # Alternatively, remote computer controller container:
  # - type: computer
  #   provider:
  #     type: remote
  #     url: "http://localhost:50051"
  #     image: "byoai/sandbox:latest"
  #     enableGUIToolsIfAvailable: false
  #     environment:
  #       ENV_VAR: "value"

  # 2. OpenAPI Tool Provider
  - type: openapi
    name: petstore
    specUrl: "https://petstore.swagger.io/v2/swagger.json"
    securityVariables:
      type: apiKey
      key: ${PETSTORE_API_KEY:-"special-key"}
      name: api_key
      location: header

  # 3. Model Context Protocol (MCP) Tool Providers
  # stdio transport (local binary/script execution)
  - name: sqlite-mcp
    type: mcp
    transport: stdio
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-sqlite"
      - "--db-path"
      - "./test.db"

  # http transport (remote MCP server)
  - name: remote-mcp
    type: mcp
    transport: http
    url: "http://localhost:8080/mcp"

  # computer transport (MCP server executed inside the registered computer provider sandbox)
  - name: sandbox-mcp
    type: mcp
    transport: computer
    command: python3
    args:
      - "/app/mcp_server.py"
```

---

## Development & Testing

Unit tests for harness configuration, model registration, skill loading, and tool provider initialization can be executed via:

```bash
cd @byo-ai-agent-platform/apps/agentic-harness
bun test
```
