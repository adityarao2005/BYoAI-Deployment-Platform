---
name: build-and-test
description: Instructions and command workflows for building and testing agentic_harness and local_models.
---
# Build and Test Workflow

Use this skill when verifying changes, executing test suites, or building project packages.

## Available Task Commands

Run commands from the repository root:

- **Generate Protobuf Stubs**:

  ```bash
  task generate_proto
  ```

- **Unit Tests**:

  ```bash
  task unit_test
  ```

  Executes tests across sub-projects (`apps/agentic-harness/`, `packages/core/`, and `apps/computer_controller/`).

- **Build**:

  ```bash
  task build
  ```

  Builds all packages and apps in the monorepo.

## Individual Sub-project Execution

- **TypeScript Monorepo**:

  ```bash
  bun run lint         # Run Biome lint
  bun run typecheck    # Run tsc --noEmit
  bun test             # Run bun test
  bun run build        # Run bun build across workspaces
  ```

- **Computer Controller (`apps/computer_controller/`)**:

  ```bash
  cd apps/computer_controller
  task test            # Run Go unit tests
  task build           # Build Go binary
  ```

- **Python Local Models (`local_models/`)**:

  ```bash
  cd local_models
  uv run python ...
  ```