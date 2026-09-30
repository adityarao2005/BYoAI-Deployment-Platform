#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load .env if present
if [ -f "${SCRIPT_DIR}/.env" ]; then
    echo "Loading environment from ${SCRIPT_DIR}/.env"
    # shellcheck disable=SC2046
    export $(grep -v '^#' "${SCRIPT_DIR}/.env" | xargs)
fi

if [ -z "${GEMINI_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "ERROR: GEMINI_API_KEY or OPENAI_API_KEY must be set."
    echo "Copy ${SCRIPT_DIR}/.env.example to ${SCRIPT_DIR}/.env and add your key."
    exit 1
fi

export AGENT_CONFIG_PATH="${SCRIPT_DIR}/agent.yaml"
echo "Starting Agentic Harness with compliance config: ${AGENT_CONFIG_PATH}"

cd "${REPO_ROOT}"
bun run --filter @byo-ai-agent-platform/agentic-harness start
