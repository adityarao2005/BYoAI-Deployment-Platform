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
task agentic_harness:run
```

**Using `bun` directly:**
```bash
bun run --filter @byo-ai-agent-platform/agentic-harness start
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

### Configuration Resolution Order

The harness resolves configuration files in the following order of precedence:

1. **`AGENT_CONFIG_PATH` environment variable** (highest priority override)
2. **Local file**: `./agent.yaml` in the current working directory
3. **System file**: `/etc/agent/agent.yaml` (Linux/container standard path)

### Environment Variable Interpolation

`agent.yaml` supports environment variable expansion directly in the file:
- **Basic variable**: `${OPENAI_API_KEY}`
- **Fallback default**: `${MAX_TOKENS:-4096}`

If an environment variable is unset and no default is specified, it evaluates to an empty string `""`.

---

### Configuration Sections

#### 1. Identity Metadata (`name`, `description`)

Optional top-level identity fields for descriptive logging and metrics:

```yaml
name: autonomous-research-agent
description: "Agent equipped with OpenAPI tools, skills, and computer execution capabilities."
```

---

#### 2. Models (`models`)

Configures LLM providers. The harness uses the first valid registered model in the list as the active LLM.

##### OpenAI Model

```yaml
models:
  - name: gpt-4o
    brand: openai
    properties:
      apiKey: ${OPENAI_API_KEY}
```

##### Gemini Model

```yaml
models:
  - name: gemini-2.5-flash
    brand: gemini
    properties:
      apiKey: ${GEMINI_API_KEY}
```

##### Anthropic Claude Model

```yaml
models:
  - name: claude-3-5-sonnet
    brand: anthropic
    properties:
      apiKey: ${ANTHROPIC_API_KEY}
      maxTokens: 4096
```

##### Self-Hosted / Local LLM (vLLM, Ollama, llama.cpp)

```yaml
models:
  - name: local-gemma
    brand: self_hosted
    properties:
      baseUrl: "http://localhost:8080/v1"
      apiKey: ${LOCAL_LLM_API_KEY:-""}
```

---

#### 3. Skill Repositories (`skillRepositories`)

Progressive skill packs containing `SKILL.md` procedural guides and helper scripts.

##### Zip Archive Skill Pack

```yaml
skillRepositories:
  - type: zip
    location: "https://example.com/skills/pet-skills.zip" # URL or local zip path
    skillsSubdirectory: "/"
```

##### Git Repository Skill Pack (with SSH Auth)

```yaml
skillRepositories:
  - type: git
    url: "git@github.com:example/agent-skills.git"
    branch: main
    skillsSubdirectory: "/skills"
    auth:
      method: ssh
      privateKeyPath: "~/.ssh/id_ed25519"
```

---

#### 4. Tool Providers (`toolProviders`)

##### A. Computer Use Tool Provider (`type: computer`)

Equips the agent with bash execution, file read/write, and optional GUI automation.

###### Local Host Execution
```yaml
toolProviders:
  - type: computer
    provider:
      type: local
      enableGUIToolsIfAvailable: true
```

###### Remote Docker Sandbox Execution
```yaml
toolProviders:
  - type: computer
    provider:
      type: remote
      url: "http://localhost:8080"
      image: "alpine:latest"
      enableGUIToolsIfAvailable: false
      security:
        apiKey: "${CC_API_KEY}" # Bearer token matching computer.yaml
      resources:
        cpu: "2"
        memory: "4GiB"
      networkRules:
        allowedHosts:
          - "*.github.com"
          - "api.openai.com"
        deniedHosts:
          - "10.0.0.0/8"
```

##### B. OpenAPI Tool Provider (`type: openapi`)

Dynamically parses an OpenAPI v2/v3 spec and exposes API endpoints as callable agent tools.

```yaml
toolProviders:
  - type: openapi
    name: petstore
    specUrl: "https://petstore.swagger.io/v2/swagger.json" # Or specPath: "./specs/petstore.json"
    securityVariables:
      type: apiKey
      key: ${PETSTORE_API_KEY:-"special-key"}
      name: api_key
      location: header # header, query, or cookie
```

###### Bearer & Basic Auth Examples

```yaml
# Bearer Token Auth
securityVariables:
  type: bearerToken
  token: ${API_BEARER_TOKEN}

# Basic Auth
securityVariables:
  type: basicAuth
  username: ${SERVICE_USER}
  password: ${SERVICE_PASS}
```

##### C. Model Context Protocol (MCP) Tool Provider (`type: mcp`)

Exposes MCP tools via `stdio`, `http`, or in-sandbox `computer` transport.

###### Standard Input/Output (stdio) Transport
```yaml
toolProviders:
  - name: sqlite-mcp
    type: mcp
    transport: stdio
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-sqlite"
      - "--db-path"
      - "./test.db"
```

###### HTTP SSE / Streamable HTTP Transport
```yaml
toolProviders:
  - name: remote-mcp
    type: mcp
    transport: http
    url: "http://localhost:8080/mcp"
    security:
      bearerToken: ${MCP_TOKEN}
```

###### Sandbox Computer Transport (Executes MCP server inside computer container)
```yaml
toolProviders:
  - name: sandbox-mcp
    type: mcp
    transport: computer
    command: python3
    args:
      - "/app/mcp_server.py"
```

##### D. Built-in Utilities (`scratchpad` & `todos`)

###### Scratchpad Provider (Inter-turn working memory notes)
```yaml
toolProviders:
  - type: scratchpad
    name: scratchpad
```

###### Todos Provider (Progress tracking checklist)
```yaml
toolProviders:
  - type: todos
    name: todos
```

---

### Full Example Configurations in Repository

- **[Pet Adoption Agent (`agent.yaml`)](file:///home/aditya/projects/BYoAI-Deployment-Platform/examples/pet-adoption-agent/agent.yaml)**: OpenAPI + Zip Skills + Gemini LLM.
- **[Local Computer Use Agent (`agent.yaml`)](file:///home/aditya/projects/BYoAI-Deployment-Platform/examples/computer-use-agent-local/agent.yaml)**: Local host computer execution + Gemini LLM.
- **[Docker Computer Use Agent (`agent.yaml`)](file:///home/aditya/projects/BYoAI-Deployment-Platform/examples/docker-computer-use/agent.yaml)**: Remote Docker sandbox computer execution + Gemini LLM.

---

## Development & Testing

Unit tests for harness configuration, model registration, skill loading, and tool provider initialization can be executed via:

```bash
# From repository root
task agentic_harness:test

# Or inside apps/agentic-harness
cd apps/agentic-harness
bun test
```
