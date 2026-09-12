# Pet Adoption & Store Agent Example

This example demonstrates how to build and run an interactive Pet Store & Adoption Assistant using the `@byo-ai-agent-platform` agentic harness.

It highlights three core platform capabilities:
1. **Dynamic OpenAPI Tool Integration**: Automatically loads and transforms the Swagger Petstore OpenAPI v2 specification (`https://petstore.swagger.io/v2/swagger.json`) into callable tools (`petstore_findPetsByStatus`, `petstore_getPetById`, `petstore_placeOrder`, etc.).
2. **Progressive Skill Loading**: Discovers and loads task-oriented procedural guides on-demand from a packaged ZIP archive (`skills.zip`).
3. **Turn-Based Observability**: Streams model reasoning, tool invocations, tool outputs, and lifecycle diagnostics directly to the terminal via `ConsoleAgentObserver`.

---

## Directory Structure

```
examples/pet-adoption-agent/
├── README.md                      # This documentation
├── agent.yaml                     # Agent configuration (models, skills repo, OpenAPI tools)
├── create-skills-zip-file.sh      # Packaging script for the skills directory
├── run-agent.sh                   # Runner script with environment validation
├── .gitignore                     # Ignores generated zip files
├── skills/                        # Procedural skill definitions
│   ├── pet-store-inventory/
│   │   └── SKILL.md               # Procedures for querying and summarizing inventory
│   └── pet-adoption-workflow/
│       └── SKILL.md               # Step-by-step workflow for adopting & ordering pets
└── skills.zip                     # (Generated) Packaged skills repository archive
```

---

## Available Skills

- **`pet-store-inventory`**:
  - Invoked when the user inquires about available pets, species, or general inventory counts.
  - Guides the model to use `petstore_findPetsByStatus` or `petstore_getInventory` and format pet records cleanly.
- **`pet-adoption-workflow`**:
  - Invoked when the user indicates intent to adopt or place an order for a pet.
  - Guides the model through status verification (`petstore_getPetById`), order confirmation, order placement (`petstore_placeOrder`), and adoption confirmation.

---

## Prerequisites

- [Bun](https://bun.sh/) (v1.0 or later)
- `zip` utility (for creating `skills.zip`)
- A valid **Gemini API Key** (`GEMINI_API_KEY`)

---

## Quickstart

### 1. Package the Skills (Optional)

`skills.zip` will be generated automatically by `run-agent.sh` if it does not already exist. You can also manually package the `skills/` folder into `skills.zip` at any time by running:

```bash
./create-skills-zip-file.sh
```

This packages:
```
skills/
├── pet-adoption-workflow/SKILL.md
└── pet-store-inventory/SKILL.md
```

### 2. Run the Agent

Run `run-agent.sh` providing your `GEMINI_API_KEY` (config and skills paths are automatically resolved to `agent.yaml` and `skills.zip`):

```bash
export GEMINI_API_KEY="your-gemini-api-key"
./run-agent.sh
```

Or as a single command:

```bash
GEMINI_API_KEY="your-gemini-api-key" ./run-agent.sh
```

*(Optional: You can still override `AGENT_CONFIG_PATH` or `AGENT_SKILLS_PATH` if using custom files).*

---

## Example Interaction Walkthrough

Once started, the agent enters an interactive REPL loop:

### 1. Inquire about store inventory
```text
Enter a message for the agent (or 'exit' to quit): Hello! What pets do you have available?
<<Processing>>...
Tool call: load_skill with arguments: {"skillName":"pet-store-inventory"}
Tool response: load_skill with result: {"success":true,"content":"..."}
Tool call: petstore_findPetsByStatus with arguments: {"status":["available"]}
Tool response: petstore_findPetsByStatus with result: [...]
assistant: We have several wonderful pets ready for adoption! Here are a few:
- Cooper (Cat, ID: 118556) - Calm
- Lucy (Cat, ID: 140468) - Energetic
- Bella (Dog, ID: 249895) - Calm
```

### 2. Ask for details and initiate adoption
```text
Enter a message for the agent (or 'exit' to quit): I'd like to adopt Lucy the cat!
<<Processing>>...
Tool call: load_skill with arguments: {"skillName":"pet-adoption-workflow"}
Tool response: load_skill with result: {"success":true,"content":"..."}
Tool call: petstore_getPetById with arguments: {"petId":140468}
Tool response: petstore_getPetById with result: {"id":140468,"name":"Lucy","status":"available"}
assistant: Lucy (Cat #140468) is currently available! Would you like me to place the adoption order now?
```

### 3. Confirm adoption
```text
Enter a message for the agent (or 'exit' to quit): Yes please, go ahead!
<<Processing>>...
Tool call: petstore_placeOrder with arguments: {"petId":140468,"quantity":1,"status":"placed","complete":true,...}
Tool response: petstore_placeOrder with result: {"id":987654,"petId":140468,"status":"placed"}
assistant: Congratulations! Your adoption order for Lucy has been placed (Order ID: #987654).
```
