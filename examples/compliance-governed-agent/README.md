# Compliance-Governed Enterprise Agent Example

This example demonstrates the complete suite of **enterprise compliance and security controls** provided by the BYoAI Agent Platform:

1. **System Prompt Compliance Rules (`rules`)**: Inline behavioral directives and external policy documents (`rules.txt`) compiled into the agent system prompt.
2. **Tool-Level Governance (`allowedTools`, `disallowedTools`, `userInputTools`)**: Whitelisting safe tools, completely blacklisting dangerous tools, and designating mutating operations for human approval.
3. **Interactive vs. Non-Interactive Mode Execution**: Automated omission of human-approval tools when running in headless batch mode to prevent execution deadlocks.
4. **Human-in-the-Loop Tool Approval**: Real-time event workflow (`tool:approval_required` → `POST /interactions/:id/tools/:toolCallId/decision`) with Chat UI and Shell CLI integration.
5. **Computer Use Sandbox Permissions (`permissions`)**: Fine-grained filesystem (`read`, `write`) and command execution (`execute`) policy enforcement on the harness.

---

## Configuration Architecture (`agent.yaml`)

```yaml
name: ComplianceGovernedAgent
description: An enterprise assistant demonstrating compliance rules, tool filtering, human-in-the-loop approvals, and strict computer use permissions.

# 1. Behavioral Rules & Policies
rules:
  - "Act professionally and explain your actions clearly."
  - "Never bypass user confirmation requests for state-mutating actions."
  - file: ./rules.txt # Explicitly loads external rule policy from disk

toolProviders:
  # 2. Tool Provider Filtering & User Input Authorization
  - name: petstore
    type: openapi
    specUrl: "https://petstore.swagger.io/v2/swagger.json"
    securityVariables:
      type: apiKey
      name: api_key
      key: "${PETSTORE_API_KEY:-special-key}"
      location: header
    allowedTools:
      - "getPetById"
      - "findPetsByStatus"
      - "addPet"
      - "updatePet"
      - "getOrderById"
      - "placeOrder"
    disallowedTools:
      - "*delete*"
      - "*Delete*"
    userInputTools:
      - "addPet"
      - "updatePet*"
      - "placeOrder"

  # 3. Computer Use Execution & Filesystem Sandboxing
  - type: computer
    provider:
      type: local
      enableGUIToolsIfAvailable: false
    allowedTools:
      - "read_file"
      - "write_file"
      - "execute"
      - "list_directory"
    disallowedTools:
      - "get_user_id"
      - "get_group_id"
    userInputTools:
      - "write_file"
      - "execute"
    permissions:
      read:
        allowed:
          - "/workspace"
          - "/tmp/*"
          - "./*"
        disallowed:
          - "/etc/*"
          - "/root/.ssh/*"
          - "/home/*/.ssh/*"
          - "*.env"
          - "*.key"
      write:
        allowed:
          - "/workspace/output/*"
          - "/tmp/*"
        disallowed:
          - "/workspace/secret.key"
          - "*.env"
      execute:
        allowed:
          - "find *"
          - "ls *"
          - "cat *"
          - "git status"
          - "echo *"
        disallowed:
          - "bash"
          - "sh"
          - "git commit*"
          - "rm -rf *"
```

---

## How It Works

### 1. Compliance Rules Injection
At agent initialization:
- File paths specified under `rules` (such as `./rules.txt`) are read from disk.
- Inline text entries and file contents are joined and embedded into the system prompt under a dedicated `## Rules & Compliance:` section.
- The LLM model is instructed to adhere strictly to these operational boundaries.

### 2. Tool Filtering & User Input Detection
The tool provider wrapper (`withToolFilter`) decorates tool lookups:
- `disallowedTools`: Tools matching pattern qualifiers (like `*delete*`) are hidden and cannot be called by the model.
- `allowedTools`: Acts as a whitelist. Any tools not matching at least one allowed pattern are excluded.
- `userInputTools`: Matching tools receive the attribute `requires_user_input: true`.

### 3. Interactive vs. Non-Interactive Provisioning
- When a session is created in **`non-interactive`** mode (`POST /interactions` with `{ "mode": "non-interactive" }`), tools requiring user input are omitted before supplying schemas to the model.
- When running in **`interactive`** mode, all permitted tools are supplied to the model.

### 4. Human-in-the-Loop Confirmation Workflow
When the model invokes a tool flagged with `requires_user_input: true`:
1. The harness pauses tool execution and emits a `tool:approval_required` Server-Sent Event (SSE) containing the tool call ID, tool name, and proposed arguments.
2. The user reviews the action:
   - **In Chat UI**: An interactive approval card is rendered with arguments and "Accept" and "Reject" buttons.
   - **In Shell CLI**: The terminal prompt highlights the pending approval and prompts `Type 'y' to accept or 'n' to reject:`.
3. The client submits the decision to `POST /interactions/:id/tools/:toolCallId/decision` with `{ "action": "accept" | "reject" }`.
4. On accept, the tool runs and returns results to the agent. On reject, the refusal is recorded and sent to the agent so it can adjust its strategy without breaking protocol invariants.

### 5. Computer Use Sandbox Permissions
When `execute`, `read_file`, `write_file`, or `list_directory` are invoked:
- **Read & Write Checks**: Target paths are evaluated against `permissions.read` and `permissions.write`. If a path matches `disallowed` (e.g., `/etc/passwd` or `*.env`), an error is thrown. Specifying a directory automatically includes all nested subdirectories and files.
- **Command Sequence Checks**: The command string is tokenized across shell delimiters (`&&`, `||`, `;`, `|`) while preserving quotes. If any sub-command in the pipeline matches a disallowed pattern (such as `bash`, `sh`, or `rm -rf *`), the entire command is rejected.

---

## Running the Example

### 1. Prerequisites
Ensure `bun` is installed and copy `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` and set your `GEMINI_API_KEY` (or `OPENAI_API_KEY`).

### 2. Start the Agentic Harness
Run the harness with the compliance configuration:

```bash
./run-agent.sh
```

### 3. Interacting with the Agent

#### Via Chat UI (`apps/chat-ui`)
1. Open the Chat UI in your browser (e.g., `http://localhost:3000`).
2. Start an interactive session.
3. Ask the agent:
   > "Please add a new pet named 'Rocky' with status 'available' to the store."
4. Observe the interactive **Tool Approval Card** in the chat transcript with the tool name `addPet` and the proposed payload.
5. Click **Accept** to execute the tool or **Reject** to deny execution.

#### Via Shell CLI (`apps/shell-cli`)
1. Launch the Shell CLI:
   ```bash
   cd apps/shell-cli
   go run ./cmd/byoai chat
   ```
2. Send:
   > "List the files in the workspace directory."
3. Send a command execution request:
   > "Run 'ls -la' to see the current directory contents."
4. Observe the interactive prompt:
   ```text
   ⚠️ Tool 'execute' requires approval [args: {"command":"ls -la"}]. Type 'y'/'yes' to accept or 'n'/'no' to reject:
   ```
5. Type `y` and press Enter to approve and continue.
