---
name: manage-local-models
description: Management and health checking procedures for local LLM model servers and containers in local_models.
---

# Local Models Management

Use this skill when starting, checking, or troubleshooting local LLM model servers (e.g. Gemma, Ollama, Docker Compose).

## Environment Setup
Check `local_models/.env` for environment configurations such as port bindings and model endpoints.

## Server Commands

- **Start Gemma server**:
  ```bash
  task local_models:run_gemma4_server
  ```
- **Stop Gemma server**:
  ```bash
  task local_models:stop_gemma4_server
  ```

## Container & Health Checks
- Run health script:
  ```bash
  ./local_models/wait-for-health.sh
  ```
- Inspect Docker Compose containers in `local_models/`:
  ```bash
  docker compose -f local_models/compose.yml ps
  ```
