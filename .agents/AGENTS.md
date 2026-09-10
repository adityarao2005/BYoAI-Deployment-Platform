# Repository Rules & Guidelines

## Code Base & Workspace Structure
- **Agent Platform**: TypeScript monorepo (`@byo-ai-agent-platform/`) using `bun` and `biome`.
- **Local Models**: Python project (`local_models/`) using `uv`, `.env`, and Docker Compose (`compose.yml`).
- Prefer using `task` via the root `Taskfile.yml` to maintain unified task execution across sub-projects.
