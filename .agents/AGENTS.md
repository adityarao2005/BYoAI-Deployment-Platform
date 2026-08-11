# Repository Rules & Guidelines

## Code Base & Workspace Structure
- **Agentic Harness**: TypeScript project (`agentic_harness/`) using `pnpm` and `vitest`.
- **Local Models**: Python project (`local_models/`) using `uv`, `.env`, and Docker Compose (`compose.yml`).
- Prefer using `task` via the root `Taskfile.yml` to maintain unified task execution across sub-projects.
