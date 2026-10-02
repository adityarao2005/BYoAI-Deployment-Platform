---
name: build-and-test
description: Instructions and command workflows for building and testing agentic_harness and local_models.
---
# Build and Test Workflow

Use this skill when verifying changes, executing test suites, or building project packages.

## Available Task Commands

Run commands from the repository root:

- **Show Version**:

  ```bash
  task version
  ```

- **Generate Protobuf Stubs**:

  ```bash
  task generate_proto
  ```

- **Unit Tests**:

  ```bash
  task unit_test
  ```

  Executes tests across sub-projects (`apps/agentic-harness/`, `packages/core/`, `apps/computer_controller/`, `apps/chat-ui/`, `apps/shell-cli/`).

- **Build**:

  ```bash
  task build
  ```

  Builds all packages and apps in the monorepo. Go binaries are compiled with version information from the `VERSION` file injected via `-ldflags`.

- **Build Container Images**:

  ```bash
  task build_container_images
  ```

  Builds Docker container images for all components (agentic-harness, computer-controller, chat-ui, shell-cli).

- **Tag a Release**:

  ```bash
  task release
  ```

  Reads the version from `VERSION`, creates an annotated git tag `v<VERSION>`, and pushes it to trigger the GitHub Actions release workflow.

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

## Versioning

The platform version is defined in the `VERSION` file at the repository root. All Go binaries have version, git commit, and build date injected via `-ldflags` at compile time.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on push/PR to `main` — lint, typecheck, test, build, validate Docker images.
- **Release** (`.github/workflows/release.yml`): Triggered by pushing a `v*` tag — cross-compiles Go binaries, pushes Docker images to GHCR, creates a GitHub Release.