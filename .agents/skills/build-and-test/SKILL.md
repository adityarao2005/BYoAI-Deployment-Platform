---
name: build-and-test
description: Instructions and command workflows for building and testing agentic_harness and local_models.
---
# Build and Test Workflow

Use this skill when verifying changes, executing test suites, or building project packages.

## Available Task Commands

Run commands from the repository root:

- **Unit Tests**:

  ```bash
  task unit_test
  ```

  Executes `vitest` unit tests inside `agentic_harness/`.

- **Integration Tests**:

  ```bash
  task integration_test
  ```

  Spins up the local model server (e.g. Gemma 4 / Ollama server in `local_models`), executes end-to-end tests against the harness, and tears down the model server. Use this sparingly and only when not very confident in the changes that you made being handled by unit tests. Furthermore, try to run these tests only once. If you are modifying the local_models, 

## Individual Sub-project Execution

- **Agent Platform Monorepo (`@byo-ai-agent-platform/`)**:

  ```bash
  cd @byo-ai-agent-platform
  task lint         # Run Biome lint
  task typecheck    # Run tsc --noEmit
  task test         # Run bun test
  task build        # Run bun build across workspaces
  ```

- **Python Local Models (`local_models/`)**:

  ```bash
  cd local_models
  uv run python ...
  ```