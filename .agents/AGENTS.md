# Repository Rules & Guidelines

## Code Base & Workspace Structure
- **Agent Platform**: TypeScript monorepo (`@byo-ai-agent-platform/`) using `bun` and `biome`.
  - Core Library/SDK: `packages/core/` (`@byo-ai-agent-platform/core`)
  - Agentic Harness CLI: `apps/agentic-harness/` (`@byo-ai-agent-platform/agentic-harness`)
  - Computer Controller: `apps/computer_controller/` (Golang daemon service)
- **Local Models**: Python project (`local_models/`) using `uv`, `.env`, and Docker Compose (`compose.yml`).
- Prefer using `task` via the root `Taskfile.yml` to maintain unified task execution across sub-projects.
